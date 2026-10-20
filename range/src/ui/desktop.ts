/**
 * The workstation shell: lock screen, sign-in, desktop, Start, taskbar and
 * tray, in the shape of Windows 11 on a domain-joined Meridian Health workstation.
 *
 * The desktop shows the real Desktop folder, so a script you save there is an
 * icon you can double-click to run. Every surface has its Windows right-click
 * menu.
 */
import { deleteFile, homeDir, renameFile } from '../world/docs.ts';
import { h, clear } from './dom.ts';
import { DEFAULT_SIGN_IN_PASSWORD, avatar, fmtDate, fmtTime, onSysChange, playSound, setLockHook, signInPassword, sys, unreadNotifications } from './system.ts';
import { aiTitle, closeFlyout, toggleCalendar, toggleHiddenIcons, toggleQuickSettings, trayVolumeIcon } from './taskbar.ts';
import { act, persist, store, subscribe } from './store.ts';
import { ai } from './aiState.ts';
import { appIcon, glyph, fileGlyph, type AppIcon } from './icons.ts';
import { type MenuEntry, closeMenus, showMenu } from './ctxmenu.ts';
import { type AppDef, closeAll, initWm, isPinned, openApp, setPinToggle, setPinned } from './wm.ts';
import { appearance, applyAppearance, applyWallpaper, lockScreenCss } from './theme.ts';
import { browserApp } from './apps/browser.ts';
import { aducApp } from './apps/aduc.ts';
import { eventViewerApp, explorerApp, fileMenu, newMenu, notepadApp, powershellApp, powershellWindow, setTerminalOpener } from './apps/tools.ts';
import { iseApp } from './apps/ise.ts';
import { terminalApp, terminalWindow } from './apps/terminal.ts';
import { rdpApp } from './apps/rdp.ts';
import { securityApp } from './apps/security.ts';
import { coachApp, setUrlOpener } from './apps/coach.ts';
import { careerApp } from './apps/career.ts';
import { setAppearance, setMousePropertiesOpener, settingsApp } from './apps/settings.ts';
import { controlPanelApp, openMouseProperties, setControlPanelLauncher } from './apps/control.ts';
import { installLaunchers, openFile, openProgram } from './launch.ts';
import { PRODUCT, PRODUCT_RELEASES_URL } from '../product.ts';
import { isDesktop } from './updates.ts';
import { mountCopilot, setCopilotBadge, toggleCopilot } from './copilot.ts';

const ise = iseApp();
const notepad = notepadApp('');
const APPS: AppDef[] = [coachApp, browserApp, aducApp, terminalApp, powershellApp, ise, rdpApp, explorerApp, eventViewerApp, notepad, controlPanelApp, settingsApp, securityApp, careerApp];
const DEFAULT_PINS = ['explorer', 'browser', 'aduc', 'terminal', 'coach'];
export const LAB_PASSWORD = 'Meridian!2026';

const desktopDir = (): string => `${homeDir(store.world)}\\Desktop`;

function pinnedApps(): AppDef[] {
  const ids = store.settings.pinned ?? DEFAULT_PINS;
  return ids.map((id) => APPS.find((a) => a.id === id)).filter((a): a is AppDef => !!a);
}

function togglePin(app: AppDef): void {
  const ids = store.settings.pinned ?? [...DEFAULT_PINS];
  store.settings.pinned = isPinned(app.id) ? ids.filter((x) => x !== app.id) : [...ids, app.id];
  persist();
  setPinned(pinnedApps());
}

function clockText(d: Date): string {
  return fmtTime(d, { h24: appearance().clock24 });
}

// ------------------------------------------------------------------- lock screen and sign-in

export function lockScreen(root: HTMLElement, done: () => void): void {
  applyAppearance();
  const p = store.world.player;
  const upn = `${p.sam}@${store.world.ad.domain}`;
  const screen = h('div', { class: 'lk', style: `background:${lockScreenCss()}`, tabIndex: 0, role: 'dialog', 'aria-label': 'Lock screen' });
  // The identity graph behind the glass: one directory at the centre, its
  // principals joined to it. Static SVG markup, no learner or model text.
  const graph = h('div', { class: 'lk-graph', 'aria-hidden': 'true' });
  const nodes = [[26, 21], [14, 44], [31, 68], [44, 12], [52, 82], [69, 26], [83, 49], [74, 71], [61, 55], [38, 40]];
  graph.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">${nodes.map(([x, y], i) => `<path d="M50 50 L${x} ${y}" style="animation-delay:${180 + i * 110}ms"/>`).join('')}${nodes.map(([x, y], i) => `<circle class="node" cx="${x}" cy="${y}" r="0.7" style="animation-delay:${i * 420}ms"/>`).join('')}<circle cx="50" cy="50" r="1.8" class="hub-ring"/><circle cx="50" cy="50" r="0.85" class="hub"/></svg>`;
  const brand = h('div', { class: 'lk-pill lk-brand' }, PRODUCT.name);
  const author = h('div', { class: 'lk-pill lk-author' }, `Created by ${PRODUCT.publisher}`);
  screen.append(graph, brand, author);
  if (!isDesktop && location.protocol === 'https:') {
    screen.appendChild(h('a', { class: 'lk-pill lk-web', href: PRODUCT_RELEASES_URL, target: '_blank', rel: 'noopener noreferrer', onClick: (e: Event) => e.stopPropagation() }, 'Web edition: progress is saved in this browser. Get the desktop app'));
  }
  let timer = 0;
  let stage: 'lock' | 'signin' = 'lock';

  const clearStage = (): void => { for (const el of [...screen.children]) if (el !== graph && el !== brand && el !== author) el.remove(); };

  function showLock(): void {
    stage = 'lock';
    clearStage();
    const time = h('div', { class: 'lk-time' });
    const date = h('div', { class: 'lk-date' });
    const tick = (): void => {
      const d = new Date();
      time.textContent = fmtTime(d, { seconds: true, h24: appearance().clock24 });
      date.textContent = fmtDate(d, 'full');
    };
    tick();
    timer = window.setInterval(tick, 1000);
    screen.appendChild(h('div', { class: 'lk-glass lk-clock' }, time, date, h('div', { class: 'lk-hint' }, 'Press any key or click to sign in')));
  }

  function showSignIn(): void {
    stage = 'signin';
    clearInterval(timer);
    clearStage();
    const msg = h('div', { class: 'lk-msg', role: 'alert' });
    const pw = h('input', { class: 'lk-input', type: 'password', placeholder: 'Password', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Password' });
    const eye = h('button', { class: 'lk-eye', type: 'button', title: 'Show password', 'aria-label': 'Show password', 'aria-pressed': 'false' }, '');
    eye.addEventListener('click', () => {
      const show = pw.type === 'password';
      pw.type = show ? 'text' : 'password';
      eye.title = show ? 'Hide password' : 'Show password';
      eye.setAttribute('aria-label', eye.title);
      eye.setAttribute('aria-pressed', String(show));
      pw.focus();
    });
    const panel = h('div', { class: 'lk-glass lk-panel' });
    const submit = (): void => {
      if (pw.value === signInPassword()) {
        playSound('logon');
        clearInterval(timer);
        screen.classList.add('leaving');
        setTimeout(() => { screen.remove(); done(); }, 280);
        return;
      }
      msg.textContent = pw.value ? 'The password is incorrect. Try again.' : 'Enter the password to sign in.';
      pw.value = '';
      panel.classList.remove('shake');
      void panel.offsetWidth;
      panel.classList.add('shake');
      pw.focus();
    };
    pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    const account = h('button', { class: 'lk-account', type: 'button', 'aria-haspopup': 'listbox' },
      avatar(24, 'lk-mini'), h('span', { class: 'lk-account-name' }, `${p.displayName} · IAM Operations`), h('span', { class: 'lk-caret' }, '▾'));
    const list = h('div', { class: 'lk-list', hidden: true, role: 'listbox' },
      h('button', { class: 'lk-row', type: 'button', role: 'option', 'aria-selected': 'true', onClick: () => { list.hidden = true; pw.focus(); } },
        avatar(24, 'lk-mini'), h('span', null, h('div', null, p.displayName), h('small', null, `${store.world.ad.netbios}\\${p.sam}`))),
      h('div', { class: 'lk-note' }, 'Other accounts sign in on their own workstations. This one is the IAM Operations workstation.'));
    account.addEventListener('click', (e) => { e.stopPropagation(); list.hidden = !list.hidden; });
    screen.addEventListener('click', () => { list.hidden = true; });
    panel.append(
      avatar(104, 'lk-avatar'),
      h('div', { class: 'lk-name' }, p.displayName),
      h('div', { class: 'lk-upn' }, upn),
      h('div', { class: 'lk-picker' }, account, list),
      msg,
      h('div', { class: 'lk-field' }, pw, eye),
      h('button', { class: 'lk-btn', type: 'button', onClick: submit }, 'Sign in'),
      sys().signInPassword ? h('div', { class: 'lk-cred' }, 'Use the password you set in Settings > Accounts.') : h('div', { class: 'lk-cred' }, 'Built-in administrator. Default password: ', h('code', null, DEFAULT_SIGN_IN_PASSWORD)),
      h('div', { class: 'lk-domain' }, `Sign in to: ${store.world.ad.netbios}`));
    panel.addEventListener('click', (e) => e.stopPropagation());
    screen.appendChild(panel);
    setTimeout(() => pw.focus(), 40);
  }

  screen.addEventListener('click', () => { if (stage === 'lock') showSignIn(); });
  screen.addEventListener('keydown', (e) => { if (stage === 'lock') { e.preventDefault(); showSignIn(); } });
  root.appendChild(screen);
  showLock();
  screen.focus();
}

// ------------------------------------------------------------------- desktop

type SortKey = 'name' | 'type' | 'date';
let sortKey: SortKey = 'name';
let globalKeysInstalled = false;
/** The signed-in shell, for the document-level listeners installed once. */
const shellState: { menu: ReturnType<typeof startMenu> | null; guards: HTMLElement[]; dispose: () => void } = { menu: null, guards: [], dispose: () => {} };

interface DeskItem {
  key: string;
  label: string;
  icon: HTMLImageElement;
  open: () => void;
  menu: (rename: () => void) => MenuEntry[];
  path?: string;
  type: string;
  date: string;
}

export function buildDesktop(root: HTMLElement): void {
  applyAppearance();
  const desk = h('main', { class: 'desk', 'aria-label': 'Desktop' });
  applyWallpaper(desk);
  const tasks = h('div', { class: 'tb-apps' });
  const tray = h('div', { class: 'tray' });
  const startBtn = h('button', { class: 'tb-app tb-start', type: 'button', title: 'Start', 'aria-label': 'Start', 'aria-haspopup': 'true' }, appIcon('start', 24));
  const searchBtn = h('button', { class: 'tb-app tb-search', type: 'button', title: 'Search', 'aria-label': 'Search' }, h('span', { class: 'mdl' }, ''));
  const copilotBtn = h('button', { class: 'tb-app tb-copilot', type: 'button', title: 'IAM Copilot (Alt+C)', 'aria-label': 'IAM Copilot' }, appIcon('copilot', 24), h('span', { class: 'tb-badge', hidden: true }));
  const bar = h('footer', { class: 'taskbar' }, h('div', { class: 'tb-center' }, startBtn, searchBtn, copilotBtn, tasks), tray);
  const menu = startMenu(root);
  const iconsEl = h('div', { class: 'icons', role: 'listbox', 'aria-label': 'Desktop icons' });
  desk.appendChild(iconsEl);
  let selected: string | null = null;
  let renaming: string | null = null;

  const shortcut = (key: string, label: string, icon: AppIcon, open: () => void, extra: MenuEntry[] = []): DeskItem => ({
    key, label, icon: appIcon(icon, 40), open, type: 'Shortcut', date: '',
    menu: () => [{ label: 'Open', icon: '', bold: true, onClick: open }, ...extra, '-', { label: 'Properties', icon: '', disabled: true }],
  });

  function items(): DeskItem[] {
    const list: DeskItem[] = [
      shortcut('sys:pc', 'This PC', 'thisPc', () => openApp(explorerApp, homeDir(store.world), false)),
      shortcut('sys:recycle', 'Recycle Bin', 'recycle', () => openApp(explorerApp, 'Recycle Bin', false)),
      shortcut('app:browser', 'Google Chrome', 'chrome', () => openApp(browserApp, undefined, false), [{ label: 'New Incognito window', icon: '', onClick: () => openProgram('chrome-incognito') }]),
      shortcut('app:aduc', 'Active Directory Users and Computers', 'aduc', () => openApp(aducApp)),
      shortcut('app:ps', 'Windows PowerShell', 'powershell', () => openApp(powershellWindow(), undefined, false), [{ label: 'Windows PowerShell ISE', icon: '', onClick: () => openApp(ise) }]),
      shortcut('app:coach', 'IAM Coach', 'coach', () => openApp(coachApp)),
      shortcut('app:control', 'Control Panel', 'control', () => openApp(controlPanelApp)),
    ];
    const dir = desktopDir().toLowerCase();
    const files = store.world.files.filter((f) => !f.deleted && f.path.toLowerCase().startsWith(`${dir}\\`) && !f.path.slice(dir.length + 1).includes('\\'));
    const fileItems: DeskItem[] = files.map((f) => ({
      key: f.path, path: f.path, label: f.path.split('\\').pop()!, icon: glyph(fileGlyph(f.path), 40), type: f.path.split('.').pop()!.toLowerCase(), date: f.modified,
      open: () => openFile(f.path), menu: (rename) => fileMenu(f.path, rename),
    }));
    fileItems.sort((a, b) => sortKey === 'date' ? b.date.localeCompare(a.date) : sortKey === 'type' ? a.type.localeCompare(b.type) || a.label.localeCompare(b.label) : a.label.localeCompare(b.label, undefined, { numeric: true }));
    return [...list, ...fileItems];
  }

  function drawIcons(): void {
    if (renaming && document.activeElement?.classList.contains('fx-rename')) return;
    clear(iconsEl);
    for (const it of items()) {
      const isRen = renaming === it.key && !!it.path;
      const startRename = (): void => { renaming = it.key; drawIcons(); };
      const label = isRen ? renameBox(it) : h('span', { class: 'icon-label' }, it.label);
      iconsEl.appendChild(h('button', {
        class: `icon ${selected === it.key ? 'selected' : ''}`, type: 'button', role: 'option', 'aria-selected': String(selected === it.key), title: it.path ?? it.label,
        onDblclick: () => it.open(),
        onClick: (e: Event) => { e.stopPropagation(); selected = it.key; markSelection(); if (window.matchMedia('(pointer: coarse)').matches) it.open(); },
        onKeydown: (e: KeyboardEvent) => {
          if (isRen) return;
          if (e.key === 'Enter') it.open();
          else if (e.key === 'F2' && it.path) { e.preventDefault(); startRename(); }
          else if (e.key === 'Delete' && it.path) { const p = it.path; act((w) => deleteFile(w, p)); }
        },
        onContextmenu: (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); selected = it.key; markSelection(); showMenu(e.clientX, e.clientY, it.menu(startRename)); },
      }, it.icon, label));
    }
    const box = iconsEl.querySelector('.fx-rename') as HTMLInputElement | null;
    if (box) { box.focus(); const dot = box.value.lastIndexOf('.'); box.setSelectionRange(0, dot > 0 ? dot : box.value.length); }
  }

  function renameBox(it: DeskItem): HTMLInputElement {
    const box = h('input', { class: 'fx-rename', value: it.label, 'aria-label': 'New name', spellcheck: 'false' });
    let done = false;
    const commit = (save: boolean): void => {
      if (done) return;
      done = true;
      const name = box.value.trim();
      renaming = null;
      if (save && name && name !== it.label) { let np = ''; if (act((w) => { np = renameFile(w, it.path!, name); })) selected = np; }
      box.blur();
      drawIcons();
    };
    box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') commit(true); if (e.key === 'Escape') commit(false); });
    box.addEventListener('blur', () => commit(true));
    box.addEventListener('click', (e) => e.stopPropagation());
    box.addEventListener('dblclick', (e) => e.stopPropagation());
    return box;
  }

  function markSelection(): void {
    const its = items();
    iconsEl.querySelectorAll('.icon').forEach((el, i) => el.classList.toggle('selected', its[i]?.key === selected));
  }

  desk.addEventListener('click', (e) => { if (e.target === desk || e.target === iconsEl) { selected = null; markSelection(); } });
  desk.addEventListener('contextmenu', (e) => {
    if (e.target !== desk && e.target !== iconsEl) return;
    e.preventDefault();
    const a = appearance();
    showMenu(e.clientX, e.clientY, [
      { label: 'View', icon: '', submenu: [
        { label: 'Large icons', checked: a.iconSize === 'large', onClick: () => setAppearance({ iconSize: 'large' }) },
        { label: 'Medium icons', checked: a.iconSize === 'medium', onClick: () => setAppearance({ iconSize: 'medium' }) },
        { label: 'Small icons', checked: a.iconSize === 'small', onClick: () => setAppearance({ iconSize: 'small' }) },
        '-',
        { label: 'Show desktop icons', checked: a.showDesktopIcons, onClick: () => setAppearance({ showDesktopIcons: !a.showDesktopIcons }) },
      ] },
      { label: 'Sort by', icon: '', submenu: [
        { label: 'Name', checked: sortKey === 'name', onClick: () => { sortKey = 'name'; drawIcons(); } },
        { label: 'Item type', checked: sortKey === 'type', onClick: () => { sortKey = 'type'; drawIcons(); } },
        { label: 'Date modified', checked: sortKey === 'date', onClick: () => { sortKey = 'date'; drawIcons(); } },
      ] },
      { label: 'Refresh', icon: '', onClick: () => { iconsEl.classList.add('refreshing'); setTimeout(() => { iconsEl.classList.remove('refreshing'); drawIcons(); }, 120); } },
      '-',
      newMenu(desktopDir(), (p) => { selected = p; renaming = p; drawIcons(); }),
      '-',
      { label: 'Display settings', icon: '', onClick: () => openApp(settingsApp, 'display') },
      { label: 'Personalize', icon: '', onClick: () => openApp(settingsApp, 'personalization') },
      '-',
      { label: 'Open in Terminal', icon: '', onClick: () => openApp(terminalWindow({ cwd: desktopDir() }), undefined, false) },
      { label: 'Show more options', icon: '', disabled: true },
    ]);
  });

  bar.addEventListener('contextmenu', (e) => {
    if ((e.target as HTMLElement).closest('.tb-app:not(.tb-start), .tray')) return;
    e.preventDefault();
    showMenu(e.clientX, e.clientY, [{ label: 'Task Manager', icon: '', disabled: true }, { label: 'Taskbar settings', icon: '', onClick: () => openApp(settingsApp, 'taskbar') }]);
  });
  startBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); menu.close(); const r = startBtn.getBoundingClientRect(); showMenu(r.left, r.top - 8, winX(root)); });
  startBtn.addEventListener('click', () => menu.toggle());
  searchBtn.addEventListener('click', () => menu.toggle(true));
  copilotBtn.addEventListener('click', () => { menu.close(); toggleCopilot(); });
  shellState.menu = menu;
  shellState.guards = [startBtn, searchBtn];

  const workstation = h('div', { class: 'workstation' }, desk, menu.el, bar);
  root.appendChild(workstation);
  mountCopilot(workstation);
  setCopilotBadge((n) => { const b = copilotBtn.querySelector('.tb-badge') as HTMLElement; b.hidden = !n; b.textContent = n > 9 ? '9+' : String(n); });
  initWm(desk, tasks, pinnedApps());
  setPinToggle(togglePin);
  setUrlOpener((url) => openApp(browserApp, url));
  installLaunchers();
  setTerminalOpener((dir) => openApp(terminalWindow({ cwd: dir }), undefined, false));
  setControlPanelLauncher((what) => {
    if (what.startsWith('settings:')) return openApp(settingsApp, what.slice(9));
    if (what === 'ise') return openApp(ise);
    openProgram(what);
  });
  setMousePropertiesOpener(openMouseProperties);

  if (!globalKeysInstalled) {
    globalKeysInstalled = true;
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      const m = shellState.menu;
      if (m && !m.el.contains(t) && !shellState.guards.some((g) => g.contains(t))) m.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && shellState.menu && !shellState.menu.el.hidden) { e.preventDefault(); shellState.menu.close(); }
    });
    document.addEventListener('keydown', (e) => {
      const k = (e.key ?? "").toLowerCase();
      if (!document.querySelector('.workstation') || document.querySelector('.lk')) return;
      if (e.key === 'Meta' && !e.altKey && !e.ctrlKey) { e.preventDefault(); shellState.menu?.toggle(); }
      else if ((e.altKey || e.metaKey) && k === 'c' && !e.ctrlKey) { e.preventDefault(); toggleCopilot(); }
      else if (e.metaKey && k === 'e') { e.preventDefault(); openApp(explorerApp, undefined, false); }
      else if (e.metaKey && k === 'r') { e.preventDefault(); runDialog(); }
      else if (e.metaKey && k === 'i') { e.preventDefault(); openApp(settingsApp); }
      else if (e.metaKey && k === 'l') { e.preventDefault(); lockSession(root); }
      else if (e.metaKey && k === 'x') { e.preventDefault(); showMenu(8, window.innerHeight - 60, winX(root)); }
    });
  }

  const hooks = { openSettings: (page: string) => openApp(settingsApp, page), openUrl: (url: string) => openApp(browserApp, url) };
  const drawTray = (): void => {
    clear(tray);
    const d = new Date();
    const y = sys();
    searchBtn.hidden = store.settings.taskbarSearch === false;
    const unread = unreadNotifications();
    tray.appendChild(h('button', { class: 'tray-btn', type: 'button', title: 'Show hidden icons', 'aria-label': 'Show hidden icons', onClick: () => toggleHiddenIcons([
      { icon: '\uE99A', title: aiTitle(), dim: ai.status !== 'online', onClick: () => openApp(settingsApp, 'lab') },
      { icon: '\uE83D', title: 'Windows Security', onClick: () => openApp(securityApp) },
      { icon: '\uE705', title: y.vpn.some((v) => v.connected) ? `VPN: connected to ${y.vpn.find((v) => v.connected)!.name}` : 'VPN: not connected', dim: !y.vpn.some((v) => v.connected), onClick: () => openApp(settingsApp, 'network') },
      { icon: '\uE702', title: y.bluetooth ? 'Bluetooth: on' : 'Bluetooth: off', dim: !y.bluetooth, onClick: () => openApp(settingsApp, 'devices') },
      { icon: '\uE895', title: 'Windows Update', onClick: () => openApp(settingsApp, 'update') },
    ]) }, h('span', { class: 'mdl' }, '\uE70E')));
    tray.appendChild(h('button', { class: 'tray-btn tray-group', type: 'button', title: `${y.airplane ? 'Airplane mode' : 'MERIDIAN-CORP: Internet access'}\nSpeakers: ${y.muted ? 'muted' : `${y.volume}%`}`, 'aria-label': 'Quick settings', onClick: () => toggleQuickSettings(hooks, drawTray) },
      h('span', { class: 'mdl' }, y.airplane ? '\uE709' : '\uE839'), y.vpn.some((v) => v.connected) ? h('span', { class: 'mdl' }, '\uE705') : null, h('span', { class: 'mdl' }, trayVolumeIcon()), h('span', { class: 'mdl' }, '\uE83E')));
    tray.appendChild(h('button', { class: 'tray-clock', type: 'button', title: fmtDate(d, 'full'), 'aria-label': `Clock: ${fmtDate(d, 'full')}. Open notifications and calendar.`, onClick: () => toggleCalendar(hooks) },
      h('span', null, clockText(d)), h('span', null, fmtDate(d))));
    tray.appendChild(h('button', { class: `tray-btn bell ${y.doNotDisturb ? 'dnd' : ''}`, type: 'button', title: y.doNotDisturb ? 'Do not disturb is on' : `${unread} new notification(s)`, 'aria-label': 'Notifications', onClick: () => toggleCalendar(hooks) },
      h('span', { class: 'mdl' }, y.doNotDisturb ? '\uE7ED' : '\uEA8F'), unread ? h('span', { class: 'bell-count' }, unread > 9 ? '9+' : String(unread)) : null));
    tray.appendChild(h('button', { class: 'tray-peek', type: 'button', title: 'Show desktop', 'aria-label': 'Show desktop', onClick: () => desk.querySelectorAll<HTMLElement>('.win').forEach((w) => w.querySelector<HTMLButtonElement>('.cap.min')?.click()) }));
  };

  drawIcons();
  drawTray();
  const unsub = subscribe(() => { drawTray(); drawIcons(); applyWallpaper(desk); });
  const unsubSys = onSysChange(drawTray);
  // Redraw on the minute (or second, when the tray shows seconds).
  const timer = setInterval(() => { if (sys().clockSeconds || new Date().getSeconds() === 0) drawTray(); }, 1000);
  setLockHook(() => lockSession(root));
  shellState.dispose = () => { unsub(); unsubSys(); clearInterval(timer); closeFlyout(); };
}

/** The Win+X menu (right-click Start). */
function winX(root: HTMLElement): MenuEntry[] {
  return [
    { label: 'Installed apps', onClick: () => openApp(settingsApp, 'apps') },
    { label: 'System', onClick: () => openApp(settingsApp, 'about') },
    { label: 'Event Viewer', onClick: () => openApp(eventViewerApp) },
    { label: 'Network Connections', onClick: () => openApp(settingsApp, 'network') },
    { label: 'Computer Management', onClick: () => openApp(aducApp) },
    '-',
    { label: 'Terminal', onClick: () => openApp(terminalApp, undefined, false) },
    { label: 'Terminal (Admin)', onClick: () => openApp(terminalApp, undefined, false) },
    '-',
    { label: 'Settings', onClick: () => openApp(settingsApp) },
    { label: 'File Explorer', onClick: () => openApp(explorerApp, undefined, false) },
    { label: 'Run', onClick: runDialog },
    '-',
    { label: 'Shut down or sign out', submenu: [{ label: 'Lock', onClick: () => lockSession(root) }, { label: 'Sign out', onClick: () => signOut(root) }, '-', { label: 'Restart', onClick: () => location.reload() }] },
    { label: 'Desktop', onClick: () => document.querySelectorAll<HTMLButtonElement>('.win .cap.min').forEach((b) => b.click()) },
  ];
}

/** Win+R. */
function runDialog(): void {
  closeMenus();
  document.querySelector('.run-dlg')?.remove();
  const input = h('input', { class: 'mm-input', style: 'flex:1', list: 'run-list', 'aria-label': 'Open' });
  const list = h('datalist', { id: 'run-list' }, ['wt', 'cmd', 'powershell', 'powershell_ise', 'mstsc', 'dsa.msc', 'eventvwr.msc', 'control', 'notepad', 'explorer', 'chrome', 'ms-settings:', 'main.cpl'].map((v) => h('option', { value: v })));
  const shield = h('div', { class: 'mm-shield run-dlg', style: 'position:fixed;z-index:100000;background:transparent;align-items:flex-end;justify-content:flex-start;padding:0 0 64px 12px' });
  const close = (): void => shield.remove();
  const ok = (): void => {
    const v = input.value.trim();
    if (!v) return;
    close();
    if (/^main\.cpl$/i.test(v)) return openMouseProperties();
    if (/^https?:\/\//i.test(v)) return openApp(browserApp, v, false);
    if (/^[A-Za-z]:\\/.test(v)) return /\.\w+$/.test(v) ? openFile(v) : openApp(explorerApp, v, false);
    const known = ['wt', 'cmd', 'cmd.exe', 'mstsc', 'mstsc.exe', 'powershell', 'powershell_ise', 'ise', 'dsa.msc', 'eventvwr', 'eventvwr.msc', 'control', 'notepad', 'explorer', 'chrome', 'msedge', 'ms-settings:'];
    if (!known.includes(v.toLowerCase())) {
      document.body.appendChild(messageShield(`Windows cannot find '${v}'. Make sure you typed the name correctly, and then try again.`));
      return;
    }
    openProgram(v);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') close(); });
  shield.appendChild(h('div', { class: 'mm-dlg', style: 'width:min(420px, calc(100% - 24px))' },
    h('div', { class: 'mm-dlg-title' }, h('span', { class: 't' }, 'Run'), h('button', { class: 'mm-dlg-x', type: 'button', onClick: close }, '✕')),
    h('div', { class: 'mm-dlg-body' },
      h('div', { class: 'mm-row', style: 'gap:12px;align-items:flex-start;margin-bottom:12px' }, h('span', { class: 'mdl', style: 'font-size:32px;color:var(--accent)' }, ''), h('span', null, 'Type the name of a program, folder, document, or Internet resource, and Windows will open it for you.')),
      h('div', { class: 'mm-row', style: 'gap:8px' }, h('label', null, 'Open:'), input, list)),
    h('div', { class: 'mm-dlg-foot' }, h('button', { class: 'mm-btn default', type: 'button', onClick: ok }, 'OK'), h('button', { class: 'mm-btn', type: 'button', onClick: close }, 'Cancel'), h('button', { class: 'mm-btn', type: 'button', onClick: () => { close(); openApp(explorerApp, undefined, false); } }, 'Browse...'))));
  document.body.appendChild(shield);
  setTimeout(() => input.focus(), 20);
}

function messageShield(text: string): HTMLElement {
  const shield = h('div', { class: 'mm-shield', style: 'position:fixed;z-index:100001' });
  shield.appendChild(h('div', { class: 'mm-dlg', style: 'width:min(400px, calc(100% - 24px))' },
    h('div', { class: 'mm-dlg-title' }, h('span', { class: 't' }, 'Run')),
    h('div', { class: 'mm-dlg-body' }, h('div', { class: 'mm-row', style: 'gap:12px' }, h('span', { class: 'mdl', style: 'font-size:28px;color:#c42b1c' }, ''), text)),
    h('div', { class: 'mm-dlg-foot' }, h('button', { class: 'mm-btn default', type: 'button', onClick: () => shield.remove() }, 'OK'))));
  return shield;
}

// ------------------------------------------------------------------- Start menu

function startMenu(root: HTMLElement): { el: HTMLElement; toggle: (focusSearch?: boolean) => void; close: () => void } {
  const search = h('input', { class: 'sm-search', type: 'search', placeholder: 'Search for apps, settings, and documents', 'aria-label': 'Search' });
  const body = h('div', { class: 'sm-body' });
  let allApps = false;
  const powerBtn = h('button', { class: 'sm-power', type: 'button', title: 'Power', 'aria-label': 'Power' }, h('span', { class: 'mdl' }, ''));
  const userBtn = h('button', { class: 'sm-user', type: 'button' }, avatar(28, 'avatar'), h('span', null, store.world.player.displayName));
  const el = h('div', { class: 'start-menu', hidden: true, role: 'dialog', 'aria-label': 'Start' },
    h('div', { class: 'sm-searchwrap' }, h('span', { class: 'mdl' }, ''), search), body,
    h('div', { class: 'sm-foot' }, userBtn, powerBtn));
  const launch = (fn: () => void): void => { api.close(); fn(); };
  powerBtn.addEventListener('click', () => { const r = powerBtn.getBoundingClientRect(); showMenu(r.left - 100, r.top - 8, [{ label: 'Lock', icon: '', onClick: () => launch(() => signOut(root)) }, { label: 'Sign out', icon: '', onClick: () => launch(() => signOut(root)) }, '-', { label: 'Restart', icon: '', onClick: () => location.reload() }]); });
  userBtn.addEventListener('click', () => { const r = userBtn.getBoundingClientRect(); showMenu(r.left, r.top - 8, [{ label: 'Change account settings', icon: '', onClick: () => launch(() => openApp(settingsApp, 'accounts')) }, { label: 'Lock', icon: '', onClick: () => launch(() => signOut(root)) }, { label: 'Sign out', icon: '', onClick: () => launch(() => signOut(root)) }]); });
  const appMenu = (a: AppDef): MenuEntry[] => [
    { label: 'Open', icon: '', bold: true, onClick: () => launch(() => openApp(a)) },
    { label: isPinned(a.id) ? 'Unpin from taskbar' : 'Pin to taskbar', icon: isPinned(a.id) ? '' : '', onClick: () => togglePin(a) },
  ];
  const tile = (a: AppDef): HTMLElement => h('button', { class: 'sm-tile', type: 'button', onClick: () => launch(() => openApp(a)), onContextmenu: (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); showMenu(e.clientX, e.clientY, appMenu(a)); } }, appIcon(a.icon, 32), h('span', null, a.title.replace('Administrator: ', '')));
  const SETTINGS_HITS: [string, string][] = [['Change the wallpaper', 'background'], ['Colors and dark mode', 'colors'], ['Themes', 'themes'], ['Mouse pointer size and colour', 'pointer'], ['Mouse settings', 'mouse'], ['Taskbar settings', 'taskbar'], ['Display and scale', 'display'], ['Notifications', 'notifications'], ['Date and time', 'time'], ['IAM Lab and AI model', 'lab']];
  const draw = (): void => {
    clear(body);
    const q = search.value.trim().toLowerCase();
    if (q) {
      const apps = APPS.filter((a) => a.title.toLowerCase().includes(q) || a.id.includes(q));
      const sets = SETTINGS_HITS.filter(([l]) => l.toLowerCase().includes(q));
      const files = store.world.files.filter((f) => !f.deleted && f.path.split('\\').pop()!.toLowerCase().includes(q)).slice(0, 8);
      body.appendChild(h('div', { class: 'sm-results' },
        apps.length ? h('h3', null, 'Apps') : null,
        apps.map((a) => h('button', { class: 'sm-row', type: 'button', onClick: () => launch(() => openApp(a)) }, appIcon(a.icon, 24), a.title)),
        sets.length ? h('h3', null, 'Settings') : null,
        sets.map(([l, page]) => h('button', { class: 'sm-row', type: 'button', onClick: () => launch(() => openApp(settingsApp, page)) }, appIcon('settings', 24), l)),
        files.length ? h('h3', null, 'Documents') : null,
        files.map((f) => h('button', { class: 'sm-row', type: 'button', onClick: () => launch(() => openFile(f.path)) }, glyph(fileGlyph(f.path), 20), h('span', null, f.path.split('\\').pop(), h('small', null, f.path.split('\\').slice(0, -1).join('\\'))))),
        !apps.length && !files.length && !sets.length ? h('p', { class: 'sm-none' }, `No results for "${search.value}"`) : null));
      return;
    }
    if (allApps) {
      body.appendChild(h('div', { class: 'sm-section' }, h('div', { class: 'sm-head' }, h('h3', null, 'All apps'), h('button', { class: 'sm-more', type: 'button', onClick: () => { allApps = false; draw(); } }, '  Back')),
        h('div', { class: 'sm-alist' }, [...APPS].sort((a, b) => a.title.localeCompare(b.title)).map((a) => h('button', { class: 'sm-row', type: 'button', onClick: () => launch(() => openApp(a)), onContextmenu: (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); showMenu(e.clientX, e.clientY, appMenu(a)); } }, appIcon(a.icon, 24), a.title)))));
      return;
    }
    body.appendChild(h('div', { class: 'sm-section' }, h('div', { class: 'sm-head' }, h('h3', null, 'Pinned'), h('button', { class: 'sm-more', type: 'button', onClick: () => { allApps = true; draw(); } }, 'All  ')),
      h('div', { class: 'sm-grid' }, APPS.map(tile))));
    if (store.settings.startRecommended === false) return;
    const recent = store.world.files.filter((f) => !f.deleted).sort((a, b) => b.modified.localeCompare(a.modified)).slice(0, 6);
    body.appendChild(h('div', { class: 'sm-section' }, h('h3', null, 'Recommended'),
      h('div', { class: 'sm-rec' }, recent.map((f) => h('button', { class: 'sm-row', type: 'button', onClick: () => launch(() => openFile(f.path)) }, glyph(fileGlyph(f.path), 24), h('span', null, f.path.split('\\').pop(), h('small', null, f.path.split('\\').slice(-2, -1)[0])))))));
  };
  search.addEventListener('input', draw);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') (body.querySelector('.sm-row, .sm-tile') as HTMLButtonElement | null)?.click();
  });
  const api = {
    el,
    toggle(focusSearch = false) {
      if (el.hidden) { search.value = ''; allApps = false; draw(); el.hidden = false; setTimeout(() => search.focus(), 30); }
      else if (!focusSearch) api.close();
    },
    close() { el.hidden = true; },
  };
  return api;
}

/** Lock: the lock screen over the running session. Windows stay open, as on Windows. */
function lockSession(root: HTMLElement): void {
  if (document.querySelector('.lk')) return;
  closeMenus();
  closeFlyout();
  shellState.menu?.close();
  lockScreen(root, () => {});
}

function signOut(root: HTMLElement): void {
  shellState.dispose();
  shellState.menu = null;
  closeAll();
  closeMenus();
  clear(root);
  lockScreen(root, () => { buildDesktop(root); firstRun(); });
}

/** Startup apps, as chosen in Settings > Apps > Startup. */
export function firstRun(): void {
  const startup = sys().startupApps;
  if (startup.includes('browser')) openApp(browserApp, 'https://servicedesk.meridianhealth.test/');
  if (startup.includes('terminal')) openProgram('wt');
  if (startup.includes('coach')) openApp(coachApp);
  if (startup.includes('notes') || !store.world.scenarios.length) openApp(notepadApp(`${desktopDir()}\\START-HERE.txt`));
  if (startup.includes('copilot')) toggleCopilot(true);
}
