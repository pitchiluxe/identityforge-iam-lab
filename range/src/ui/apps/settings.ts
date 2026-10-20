/**
 * Settings, as on Windows 11: Personalization, Accessibility (mouse pointer),
 * Time & language, Accounts and the rest, plus an IAM Lab page for the
 * range's own options. Every change applies immediately, as in Windows.
 */
import { button, clear, h, toast } from '../dom.ts';
import { notify, persist, resetWorld, store } from '../store.ts';
import { ai, chooseModel, refreshAi } from '../aiState.ts';
import { ACCENTS, type Appearance, appearance, applyAppearance, lockScreenCss, wallpaperCss } from '../theme.ts';
import { CUSTOM_WALLPAPER_KEY, DEFAULT_LOCK_SCREEN_ID, DEFAULT_WALLPAPER_ID, allWallpapers, backgroundFor } from '../wallpapers.ts';
import { generateBatch } from '../wallpaperGenerator.ts';
import { DEFAULT_SIGN_IN_PASSWORD, REGIONS, type SystemSettings, TIME_ZONES, applySystem, avatar, avatarData, fmtDate, fmtTime, lockNow, onSysChange, playSound, removeAvatar, setAvatarFromFile, setSys, signInPassword, sys } from '../system.ts';
import { appVersion, checkForUpdates, installUpdate, isDesktop, onUpdateChange, updateStatus } from '../updates.ts';
import { PRODUCT, PRODUCT_RELEASES_URL } from '../../product.ts';
import { type AppDef, onOpenArg } from '../wm.ts';

type Page = 'home' | 'system' | 'display' | 'sound' | 'notifications' | 'about' | 'devices' | 'mouse' | 'network' | 'personalization' | 'background' | 'colors' | 'themes' | 'lockscreen' | 'start' | 'taskbar'
  | 'apps' | 'accounts' | 'time' | 'gaming' | 'accessibility' | 'pointer' | 'effects' | 'privacy' | 'update' | 'lab';

const NAV: [Page, string, string][] = [
  ['home', 'Home', ''], ['system', 'System', ''], ['devices', 'Bluetooth & devices', ''], ['network', 'Network & internet', ''],
  ['personalization', 'Personalization', ''], ['apps', 'Apps', ''], ['accounts', 'Accounts', ''], ['time', 'Time & language', ''],
  ['gaming', 'Gaming', ''], ['accessibility', 'Accessibility', ''], ['privacy', 'Privacy & security', ''], ['update', 'Windows Update', ''],
  ['lab', 'IAM Lab', ''],
];
const PARENT: Partial<Record<Page, Page>> = {
  display: 'system', sound: 'system', notifications: 'system', about: 'system', mouse: 'devices', background: 'personalization', colors: 'personalization', themes: 'personalization',
  lockscreen: 'personalization', start: 'personalization', taskbar: 'personalization', pointer: 'accessibility', effects: 'accessibility',
};
const TITLES: Partial<Record<Page, string>> = { display: 'Display', sound: 'Sound', notifications: 'Notifications', about: 'About', mouse: 'Mouse', background: 'Background', colors: 'Colors', themes: 'Themes', lockscreen: 'Lock screen', start: 'Start', taskbar: 'Taskbar', pointer: 'Mouse pointer and touch', effects: 'Visual effects' };

export function setAppearance(patch: Partial<Appearance>): void {
  store.settings.appearance = { ...(store.settings.appearance ?? {}), ...patch };
  persist();
  applyAppearance();
  notify();
}

function toggle(on: boolean, label: string, onChange: (v: boolean) => void): HTMLElement {
  return h('label', { class: 'ws-toggle' }, h('span', { class: 'ws-toggle-text' }, on ? 'On' : 'Off'),
    h('input', { type: 'checkbox', role: 'switch', checked: on, 'aria-label': label, onChange: (e: Event) => onChange((e.target as HTMLInputElement).checked) }), h('span', { class: 'ws-switch' }));
}

function card(icon: string, title: string, desc: string, control: HTMLElement | null, onClick?: () => void): HTMLElement {
  return h(onClick ? 'button' : 'div', { class: `ws-card ${onClick ? 'link' : ''}`, type: onClick ? 'button' : undefined, onClick },
    h('span', { class: 'ws-card-icon mdl' }, icon),
    h('span', { class: 'ws-card-text' }, h('span', { class: 'ws-card-title' }, title), desc ? h('span', { class: 'ws-card-desc' }, desc) : null),
    control ?? (onClick ? h('span', { class: 'mdl ws-chev' }, '') : null));
}

function select(value: string, options: [string, string][], onChange: (v: string) => void, label: string): HTMLSelectElement {
  return h('select', { class: 'input ws-select', 'aria-label': label, onChange: (e: Event) => onChange((e.target as HTMLSelectElement).value) }, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
}

export const settingsApp: AppDef = {
  id: 'settings',
  title: 'Settings',
  icon: 'settings',
  width: 1040,
  height: 700,
  mount(host, win) {
    let page: Page = (win.arg as Page) || 'home';
    let query = '';
    onOpenArg(win, (p) => { if (p) { page = p as Page; draw(); } });
    const go = (p: Page): void => { page = p; draw(); };

    /** Thumbnails of every background, plus Generate (seeded, offline, never repeats). */
    function picker(kind: 'wall' | 'lock'): HTMLElement {
      const st = store.settings;
      const key = kind === 'wall' ? 'generatedWallpapers' : 'generatedLockScreens';
      const current = kind === 'wall' ? st.wallpaper ?? DEFAULT_WALLPAPER_ID : st.lockScreen ?? DEFAULT_LOCK_SCREEN_ID;
      const list = allWallpapers(st[key] ?? [], kind);
      return h('div', null,
        h('div', { class: 'ws-pics' }, list.map((wp) => h('button', { class: `ws-pic ${current === wp.id ? 'on' : ''}`, type: 'button', title: wp.label, 'aria-label': wp.label, style: `background:${wp.gradient}`,
          onClick: () => { if (kind === 'wall') { st.wallpaper = wp.id; setAppearance({ solidColor: null }); } else { st.lockScreen = wp.id; persist(); } draw(); } }))),
        h('div', { class: 'row', style: 'margin-top:12px' },
          button('Generate new backgrounds', () => { const batch = generateBatch(6, kind, st[key] ?? []); st[key] = [...(st[key] ?? []), ...batch.map((w) => w.id)].slice(-24); persist(); toast('Six new backgrounds added', 'ok'); draw(); }, 'btn'),
          h('span', { class: 'muted' }, 'Generated on this computer from a seed. No download, no AI model.')));
    }

    function body(): HTMLElement {
      const a = appearance();
      const s = store.settings;
      const y = sys();
      const range = (value: number, min: number, max: number, label: string, onInput: (v: number) => void): HTMLInputElement =>
        h('input', { type: 'range', class: 'ws-range', min: String(min), max: String(max), value: String(value), 'aria-label': label, onInput: (e: Event) => onInput(Number((e.target as HTMLInputElement).value)) });
      const group = (title: string, ...kids: (HTMLElement | null)[]): HTMLElement => h('div', { class: 'ws-group' }, h('h3', null, title), ...kids);
      switch (page) {
        case 'home': {
          const u = updateStatus;
          return h('div', { class: 'ws-stack' },
            h('div', { class: 'ws-hero', style: `background:${wallpaperCss()}` }, h('div', null, h('strong', null, 'MHS-IAM-WKS01'), h('span', null, 'Windows 11 Enterprise'))),
            card('', 'Personalization', 'Background, colors, themes, lock screen, taskbar', null, () => go('personalization')),
            card('', 'Your account', `${store.world.player.displayName}: picture, sign-in options`, null, () => go('accounts')),
            card('', 'Display and sound', `Brightness ${y.brightness}%, volume ${y.muted ? 'muted' : `${y.volume}%`}`, null, () => go('system')),
            card('', 'Windows Update', u.state === 'downloaded' ? 'An update is ready to install' : isDesktop ? `Version ${appVersion}` : 'Web edition', null, () => go('update')),
            card('', 'IAM Lab', 'AI assistant, background sync, start over', null, () => go('lab')));
        }
        case 'system':
          return h('div', { class: 'ws-stack' },
            card('', 'Display', 'Brightness, night light, scale', null, () => go('display')),
            card('', 'Sound', y.muted ? 'Muted' : `Volume ${y.volume}%`, null, () => go('sound')),
            card('', 'Notifications', 'Alerts from apps and the system, do not disturb', null, () => go('notifications')),
            card('', 'About', 'Device specifications', null, () => go('about')));
        case 'display':
          return h('div', { class: 'ws-stack' },
            group('Brightness and colour',
              h('div', { class: 'ws-line' }, h('span', { class: 'mdl' }, ''), range(y.brightness, 20, 100, 'Brightness', (v) => setSys({ brightness: v })), h('span', { class: 'ws-val' }, `${y.brightness}%`)),
              h('div', { class: 'ws-line' }, h('span', null, 'Night light: warmer colours to help block blue light'), toggle(!!s.nightLight, 'Night light', (v) => { s.nightLight = v; persist(); applySystem(); draw(); }))),
            card('', 'Scale', 'Change the size of text, apps and other items', select(String(s.scale ?? 100), [['90', '90%'], ['100', '100% (Recommended)'], ['110', '110%'], ['125', '125%']], (v) => { s.scale = Number(v); persist(); document.documentElement.style.zoom = String(Number(v) / 100); }, 'Scale')),
            card('', 'Contrast themes', 'Stronger contrast for text and borders', toggle(y.contrast, 'Contrast', (v) => setSys({ contrast: v }))));
        case 'sound':
          return h('div', { class: 'ws-stack' },
            group('Output', h('div', { class: 'ws-line' }, button(y.muted ? '' : '', () => setSys({ muted: !y.muted }), 'btn icon-btn mdl', y.muted ? 'Unmute' : 'Mute'), range(y.volume, 0, 100, 'Volume', (v) => setSys({ volume: v, muted: false })), h('span', { class: 'ws-val' }, `${y.volume}%`)),
              h('p', { class: 'muted' }, 'Speakers (Realtek(R) Audio)'), button('Test', () => playSound('test'), 'btn')),
            card('', 'Notification sounds', 'Play a sound when a notification arrives', toggle(y.notificationSounds, 'Notification sounds', (v) => setSys({ notificationSounds: v }))));
        case 'notifications':
          return h('div', { class: 'ws-stack' },
            card('', 'Notifications', 'Get notifications from apps and other senders', toggle(s.notifications !== false, 'Notifications', (v) => { s.notifications = v; persist(); draw(); })),
            card('', 'Do not disturb', 'Notifications go straight to the notification centre', toggle(y.doNotDisturb, 'Do not disturb', (v) => setSys({ doNotDisturb: v }))),
            card('', 'IAM Copilot nudges', 'Copilot speaks up when an action breaks a control', toggle(s.copilotNudges !== false, 'Copilot nudges', (v) => { s.copilotNudges = v; persist(); draw(); })));
        case 'about': {
          const specs: [string, string][] = [['Device name', 'MHS-IAM-WKS01'], ['Full device name', `MHS-IAM-WKS01.${store.world.ad.domain}`], ['Processor', 'Intel(R) Core(TM) i7-1265U @ 2.70GHz'], ['Installed RAM', '16.0 GB'], ['System type', '64-bit operating system, x64-based processor'], ['Domain', store.world.ad.domain]];
          const win: [string, string][] = [['Edition', 'Windows 11 Enterprise'], ['Version', '23H2'], ['OS build', '22631.4317'], ['Range version', `${PRODUCT.name} ${appVersion}`]];
          const dl = (rows: [string, string][]): HTMLElement => h('dl', { class: 'kv' }, ...rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
          return h('div', { class: 'ws-stack' },
            group('Device specifications', dl(specs), button('Copy', () => { void navigator.clipboard?.writeText(specs.map(([k, v]) => `${k}\t${v}`).join('\n')).then(() => toast('Device specifications copied', 'ok')).catch(() => undefined); }, 'btn')),
            group('Windows specifications', dl(win)),
            h('p', { class: 'muted' }, 'Meridian Health System and everyone in it are fictional; nothing here connects to a real directory or tenant.'));
        }
        case 'devices':
          return h('div', { class: 'ws-stack' },
            card('', 'Bluetooth', y.bluetooth ? 'Discoverable as "MHS-IAM-WKS01". No devices nearby.' : 'Off', toggle(y.bluetooth, 'Bluetooth', (v) => setSys({ bluetooth: v }))),
            card('', 'Mouse', 'Pointer style, colour and size', null, () => go('mouse')),
            card('', 'Printers & scanners', 'Microsoft Print to PDF (default)', button('Print test page', () => window.print(), 'btn')));
        case 'mouse':
          return h('div', { class: 'ws-stack' },
            card('', 'Mouse pointer', 'Change the style, colour and size', null, () => go('pointer')),
            card('', 'Additional mouse settings', 'Pointer schemes in Control Panel', null, () => openMouseProperties()));
        case 'network': {
          const online = navigator.onLine && !y.airplane;
          return h('div', { class: 'ws-stack' },
            h('div', { class: 'ws-hero small' }, h('span', { class: 'mdl ws-update-icon' }, y.airplane ? '' : ''), h('div', null, h('strong', null, y.airplane ? 'Airplane mode is on' : 'Ethernet'), h('span', null, online ? `Connected, ${store.world.ad.domain}` : 'No internet'))),
            card('', 'Airplane mode', 'Stops all wireless communication: real websites stop loading in Chrome', toggle(y.airplane, 'Airplane mode', (v) => setSys({ airplane: v }))),
            group('VPN',
              ...y.vpn.map((v, i) => h('div', { class: 'ws-line' }, h('span', { class: 'mdl' }, ''), h('span', { style: 'flex:1' }, h('strong', null, v.name), h('span', { class: 'muted block' }, `${v.server}${v.connected ? ', connected' : ''}`)),
                button(v.connected ? 'Disconnect' : 'Connect', () => { const list = [...y.vpn]; list[i] = { ...v, connected: !v.connected }; setSys({ vpn: list }); toast(v.connected ? `Disconnected from ${v.name}` : `Connected to ${v.name}`, 'ok'); }, 'btn'),
                button('Remove', () => setSys({ vpn: y.vpn.filter((_, j) => j !== i) }), 'btn ghost'))),
              h('div', { class: 'row', style: 'margin-top:8px' }, button('Add VPN', () => {
                const name = prompt('Connection name', 'Meridian Remote Access');
                if (!name) return;
                const server = prompt('Server name or address', 'vpn.meridianhealth.test');
                if (server) setSys({ vpn: [...y.vpn, { name, server, connected: false }] });
              }, 'btn primary'))),
            card('', 'Proxy', y.proxy ? `Using ${y.proxy}` : 'Automatically detect settings', button(y.proxy ? 'Turn off' : 'Set up', () => { if (y.proxy) setSys({ proxy: '' }); else { const p = prompt('Proxy address:port', 'proxy.meridianhealth.test:8080'); if (p) setSys({ proxy: p }); } }, 'btn')));
        }
        case 'personalization':
          return h('div', { class: 'ws-stack' },
            h('div', { class: 'ws-preview', style: `background:${wallpaperCss()}` }, h('div', { class: 'ws-preview-win' })),
            card('', 'Background', 'Background image, colour', null, () => go('background')),
            card('', 'Colors', 'Accent colour, transparency effects, colour theme', null, () => go('colors')),
            card('', 'Themes', 'Choose a theme', null, () => go('themes')),
            card('', 'Lock screen', 'Lock screen background', null, () => go('lockscreen')),
            card('', 'Start', 'Recommended files', null, () => go('start')),
            card('', 'Taskbar', 'Alignment, search, icons', null, () => go('taskbar')));
        case 'background': {
          const upload = h('input', { type: 'file', accept: 'image/*', hidden: true, onChange: (e: Event) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            if (file.size > 4_000_000) return toast('Choose a picture under 4 MB.', 'err');
            const r = new FileReader();
            r.onload = () => { try { localStorage.setItem(CUSTOM_WALLPAPER_KEY, String(r.result)); } catch { return toast('This browser could not store the picture.', 'err'); } s.wallpaper = 'custom'; setAppearance({ solidColor: null }); draw(); };
            r.readAsDataURL(file);
          } });
          return h('div', { class: 'ws-stack' },
            card('', 'Personalize your background', '', select(a.solidColor ? 'solid' : 'picture', [['picture', 'Picture'], ['solid', 'Solid color']], (v) => setAppearance({ solidColor: v === 'solid' ? '#004a77' : null }), 'Background type')),
            a.solidColor
              ? group('Choose your background colour', h('div', { class: 'ws-swatches' }, ['#004a77', '#1f1f1f', '#4a5459', '#00585b', '#5c2d91', '#7a1f1f', '#2d4f2d', '#0063b1'].map((c) => h('button', { class: `ws-swatch ${a.solidColor === c ? 'on' : ''}`, type: 'button', style: `background:${c}`, 'aria-label': c, onClick: () => setAppearance({ solidColor: c }) }))))
              : group('Choose a background', picker('wall'), h('div', { class: 'row' }, h('span', null, 'Choose a photo'), button('Browse photos', () => upload.click(), 'btn'), upload)),
            card('', 'Choose a fit for your desktop image', '', select(a.wallpaperFit, [['fill', 'Fill'], ['fit', 'Fit'], ['center', 'Center']], (v) => setAppearance({ wallpaperFit: v as Appearance['wallpaperFit'] }), 'Fit')));
        }
        case 'colors':
          return h('div', { class: 'ws-stack' },
            card('', 'Choose your mode', 'Change the colours that appear in Windows and your apps', select(a.mode, [['light', 'Light'], ['dark', 'Dark'], ['system', 'Custom (follow this computer)']], (v) => setAppearance({ mode: v as Appearance['mode'] }), 'Mode')),
            card('', 'Transparency effects', 'Windows and surfaces appear translucent', toggle(a.transparency, 'Transparency', (v) => setAppearance({ transparency: v }))),
            group('Accent color', h('div', { class: 'ws-swatches' }, ACCENTS.map((c) => h('button', { class: `ws-swatch ${a.accent === c ? 'on' : ''}`, type: 'button', style: `background:${c}`, 'aria-label': `Accent ${c}`, onClick: () => setAppearance({ accent: c }) }))),
              h('div', { class: 'row', style: 'margin-top:12px' }, h('span', null, 'Custom colour'), h('input', { type: 'color', value: a.accent, 'aria-label': 'Custom accent colour', onChange: (e: Event) => setAppearance({ accent: (e.target as HTMLInputElement).value }) }))));
        case 'themes': {
          const themes: [string, string, Partial<Appearance>, string][] = [
            ['Meridian (light)', 'meridian-dark', { mode: 'light', accent: '#005fb8', solidColor: null }, '#f3f3f3'],
            ['Meridian (dark)', 'meridian-navy', { mode: 'dark', accent: '#005fb8', solidColor: null }, '#202020'],
            ['Clinical Teal', 'meridian-teal', { mode: 'dark', accent: '#038387', solidColor: null }, '#1b2a2a'],
            ['Windows Blue', 'windows-blue', { mode: 'light', accent: '#0063b1', solidColor: null }, '#f3f3f3'],
            ['Dusk', 'dusk', { mode: 'dark', accent: '#8764b8', solidColor: null }, '#202020'],
            ['Forest', 'forest', { mode: 'dark', accent: '#107c10', solidColor: null }, '#1b2a1f'],
          ];
          return h('div', { class: 'ws-stack' }, group('Current theme: choose one to apply',
            h('div', { class: 'ws-themes' }, themes.map(([name, wp, patch, bg]) => h('button', { class: 'ws-theme', type: 'button', onClick: () => { s.wallpaper = wp; setAppearance(patch); toast(`Theme applied: ${name}`, 'ok'); draw(); } },
              h('span', { class: 'ws-theme-img', style: `background:${backgroundFor(wp, 'wall')}` }, h('span', { class: 'ws-theme-win', style: `background:${bg};border-top:4px solid ${patch.accent}` })), h('span', null, name))))));
        }
        case 'lockscreen':
          return h('div', { class: 'ws-stack' },
            h('div', { class: 'ws-preview', style: `background:${lockScreenCss()}` }),
            group('Personalize your lock screen', picker('lock')),
            card('', 'Lock now', 'Shows the lock screen; sign in again to continue', button('Lock', () => lockNow(), 'btn')));
        case 'start':
          return h('div', { class: 'ws-stack' },
            card('', 'Show recommended files in Start', 'Recent documents from your folders', toggle(s.startRecommended !== false, 'Recommended', (v) => { s.startRecommended = v; persist(); draw(); })));
        case 'taskbar':
          return h('div', { class: 'ws-stack' },
            card('', 'Taskbar alignment', '', select(a.taskbarAlign, [['center', 'Center'], ['left', 'Left']], (v) => setAppearance({ taskbarAlign: v as Appearance['taskbarAlign'] }), 'Taskbar alignment')),
            card('', 'Search', 'Show the search button on the taskbar', toggle(s.taskbarSearch !== false, 'Search button', (v) => { s.taskbarSearch = v; persist(); notify(); draw(); })),
            card('', 'Show seconds in system tray clock', '', toggle(y.clockSeconds, 'Seconds', (v) => setSys({ clockSeconds: v }))),
            card('', 'Desktop icons', 'Show desktop icons', toggle(a.showDesktopIcons, 'Desktop icons', (v) => setAppearance({ showDesktopIcons: v }))),
            card('', 'Desktop icon size', '', select(a.iconSize, [['small', 'Small icons'], ['medium', 'Medium icons'], ['large', 'Large icons']], (v) => setAppearance({ iconSize: v as Appearance['iconSize'] }), 'Icon size')));
        case 'apps': {
          const startup: [string, string][] = [['coach', 'IAM Coach'], ['notes', 'START-HERE.txt'], ['browser', 'Google Chrome (ServiceDesk)'], ['copilot', 'IAM Copilot'], ['terminal', 'Terminal']];
          return h('div', { class: 'ws-stack' },
            group('Default apps',
              h('div', { class: 'ws-line' }, h('span', { style: 'flex:1' }, 'When you open a .ps1 file'), select(y.ps1Action, [['run', 'Run with PowerShell'], ['edit', 'Edit in Windows PowerShell ISE'], ['notepad', 'Open in Notepad']], (v) => setSys({ ps1Action: v as SystemSettings['ps1Action'] }), '.ps1 files')),
              h('div', { class: 'ws-line' }, h('span', { style: 'flex:1' }, 'When you open a .bat or .cmd file'), select(y.batAction, [['run', 'Run in Command Prompt'], ['edit', 'Edit in Notepad']], (v) => setSys({ batAction: v as SystemSettings['batAction'] }), '.bat files'))),
            group('Startup', h('p', { class: 'muted' }, 'Apps that open when you sign in.'),
              ...startup.map(([id, label]) => h('div', { class: 'ws-line' }, h('span', { style: 'flex:1' }, label), toggle(y.startupApps.includes(id), label, (v) => setSys({ startupApps: v ? [...y.startupApps, id] : y.startupApps.filter((x) => x !== id) }))))),
            group('Installed apps',
              ...([['Active Directory Users and Computers (RSAT)', '10.0.22621'], ['Google Chrome', '129.0.6668.90'], ['Windows Terminal', '1.21.2911.0'], ['Remote Desktop Connection', '10.0.22621'], ['Windows PowerShell ISE', '10.0.22621'], ['Microsoft Graph PowerShell SDK', '2.25.0'], ['IAM Coach', appVersion], ['Notepad', '11.2409.9.0']] as [string, string][])
                .map(([n, v]) => h('div', { class: 'ws-app' }, h('span', null, n), h('span', { class: 'muted' }, v)))));
        }
        case 'accounts': {
          const upload = h('input', { type: 'file', accept: 'image/*', hidden: true, onChange: (e: Event) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            setAvatarFromFile(file).then(() => { toast('Account picture updated', 'ok'); draw(); }).catch((err: Error) => toast(err.message, 'err'));
          } });
          const pw1 = h('input', { class: 'input', type: 'password', placeholder: 'Current password', autocomplete: 'current-password', 'aria-label': 'Current password' });
          const pw2 = h('input', { class: 'input', type: 'password', placeholder: 'New password', autocomplete: 'new-password', 'aria-label': 'New password' });
          const pw3 = h('input', { class: 'input', type: 'password', placeholder: 'Confirm new password', autocomplete: 'new-password', 'aria-label': 'Confirm new password' });
          const change = (): void => {
            if (pw1.value !== signInPassword()) return toast('The current password is incorrect.', 'err');
            if (pw2.value.length < 12 || [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw2.value)).length < 3) return toast('The new password does not meet the policy: 12 or more characters with three of upper case, lower case, digits and symbols.', 'err');
            if (pw2.value !== pw3.value) return toast('The passwords do not match.', 'err');
            setSys({ signInPassword: pw2.value });
            toast('Password changed. Use it the next time you sign in.', 'ok');
            draw();
          };
          return h('div', { class: 'ws-stack' },
            h('div', { class: 'ws-hero small' }, avatar(72, 'avatar'), h('div', null, h('strong', null, store.world.player.displayName), h('span', null, `${store.world.ad.netbios}\\${store.world.player.sam}`), h('span', null, `Administrator. Privileged changes run as ${store.world.player.adminSam}.`))),
            group('Your info', h('p', { class: 'muted' }, 'Your picture appears on the sign-in screen, in Start, Settings and Chrome.'),
              h('div', { class: 'row' }, button('Browse files', () => upload.click(), 'btn primary'), avatarData() ? button('Remove picture', () => { removeAvatar(); draw(); }, 'btn ghost') : null, upload)),
            group('Sign-in options',
              h('p', { class: 'muted' }, y.signInPassword ? 'You set your own sign-in password. The sign-in screen no longer shows it.' : `The default password ${DEFAULT_SIGN_IN_PASSWORD} is shown on the sign-in screen until you change it.`),
              h('div', { class: 'ws-pw' }, pw1, pw2, pw3),
              h('div', { class: 'row' }, button('Change password', change, 'btn primary'), y.signInPassword ? button('Restore the default password', () => { setSys({ signInPassword: null }); toast('Default password restored', 'ok'); draw(); }, 'btn ghost') : null),
              h('div', { class: 'ws-line', style: 'margin-top:10px' }, h('span', { style: 'flex:1' }, 'If you have been away, when should Windows require you to sign in again?'),
                select(String(y.idleLockMinutes), [['0', 'Never'], ['1', 'After 1 minute'], ['5', 'After 5 minutes'], ['15', 'After 15 minutes'], ['30', 'After 30 minutes']], (v) => setSys({ idleLockMinutes: Number(v) }), 'Require sign-in'))),
            card('', 'Access work or school', `Connected to ${store.world.company.name} Active Directory domain (${store.world.ad.domain})`, null));
        }
        case 'time': {
          const now = new Date();
          return h('div', { class: 'ws-stack' },
            h('div', { class: 'ws-hero small' }, h('span', { class: 'mdl ws-update-icon' }, ''), h('div', null, h('strong', null, fmtTime(now, { seconds: false })), h('span', null, fmtDate(now, 'full')))),
            card('', 'Time zone', 'Changes the taskbar clock, calendar and lock screen', select(y.timeZone, [...new Set([y.timeZone, ...TIME_ZONES])].map((z) => [z, z.replace(/_/g, ' ')] as [string, string]), (v) => setSys({ timeZone: v }), 'Time zone')),
            card('', 'Regional format', 'Date and time formats', select(y.region, REGIONS.some(([r]) => r === y.region) ? REGIONS : [[y.region, y.region], ...REGIONS], (v) => setSys({ region: v }), 'Regional format')),
            card('', 'Use 24-hour clock', '', toggle(a.clock24, '24-hour clock', (v) => setAppearance({ clock24: v }))),
            card('', 'Show the long date in the taskbar', '', toggle(y.longDate, 'Long date', (v) => setSys({ longDate: v }))));
        }
        case 'gaming':
          return h('div', { class: 'ws-stack' },
            card('', 'Game Mode', 'Holds notifications and Copilot pop-ups in the notification centre while it is on', toggle(y.gameMode, 'Game Mode', (v) => setSys({ gameMode: v }))));
        case 'accessibility':
          return h('div', { class: 'ws-stack' },
            card('', 'Mouse pointer and touch', 'Style, colour, size', null, () => go('pointer')),
            card('', 'Contrast themes', 'Stronger contrast for text and borders', toggle(y.contrast, 'Contrast', (v) => setSys({ contrast: v }))),
            card('', 'Visual effects', 'Transparency and animation', null, () => go('effects')),
            card('', 'Text size', 'Display scale', null, () => go('display')));
        case 'pointer': {
          const styles: [Appearance['pointerStyle'], string, string, string][] = [['white', 'White', '#fff', '#000'], ['black', 'Black', '#000', '#fff'], ['inverted', 'Inverted', 'linear-gradient(135deg,#fff 50%,#000 50%)', '#666'], ['custom', 'Custom', a.pointerColor, '#000']];
          return h('div', { class: 'ws-stack' },
            group('Mouse pointer style',
              h('div', { class: 'ws-pointers' }, styles.map(([id, label, fill, stroke]) => h('button', { class: `ws-pointer ${a.pointerStyle === id ? 'on' : ''}`, type: 'button', 'aria-label': label, title: label, onClick: () => setAppearance({ pointerStyle: id }) },
                h('span', { class: 'ws-pointer-glyph', style: `background:${fill};outline:1.5px solid ${stroke}` }), h('span', null, label)))),
              a.pointerStyle === 'custom' ? h('div', null, h('p', { class: 'muted' }, 'Recommended colours'),
                h('div', { class: 'ws-swatches' }, ['#7cfc00', '#ff2d95', '#00e5ff', '#ffd400', '#ff6a00', '#a259ff'].map((c) => h('button', { class: `ws-swatch ${a.pointerColor === c ? 'on' : ''}`, type: 'button', style: `background:${c}`, 'aria-label': c, onClick: () => setAppearance({ pointerColor: c }) })),
                  h('input', { type: 'color', value: a.pointerColor, 'aria-label': 'Choose another colour', onChange: (e: Event) => setAppearance({ pointerColor: (e.target as HTMLInputElement).value }) }))) : null),
            group('Size', range(a.pointerSize, 1, 4, 'Pointer size', (v) => setAppearance({ pointerSize: v }))),
            card('', 'Additional mouse settings', 'Pointer schemes in Control Panel', null, () => openMouseProperties()));
        }
        case 'effects':
          return h('div', { class: 'ws-stack' },
            card('', 'Transparency effects', '', toggle(a.transparency, 'Transparency', (v) => setAppearance({ transparency: v }))),
            card('', 'Animation effects', '', toggle(a.animations, 'Animation', (v) => setAppearance({ animations: v }))));
        case 'privacy':
          return h('div', { class: 'ws-stack' },
            card('', 'Local AI (Ollama)', 'Let IAM Copilot, the mentor and AI-designed labs use the model on this computer', toggle(y.localAi, 'Local AI', (v) => { setSys({ localAi: v }); void refreshAi(); })),
            card('', 'Activity history', 'Chrome history and recent files in Start', button('Clear history', () => {
              if (s.browser) s.browser.history = [];
              persist();
              toast('Activity history cleared', 'ok');
            }, 'btn')),
            card('', 'Windows Security', 'Antivirus, firewall and device protection are managed by your organization', null));
        case 'update': {
          const u = updateStatus;
          const busy = u.state === 'checking' || u.state === 'downloading' || u.state === 'available';
          const headline = !isDesktop ? 'Updates come with the installed app'
            : u.state === 'checking' ? 'Checking for updates...'
            : u.state === 'available' ? `Update ${u.info?.version ?? ''} found. Downloading...`
            : u.state === 'downloading' ? `Downloading update ${u.info?.version ?? ''}: ${u.info?.progress ?? 0}%`
            : u.state === 'downloaded' ? `Update ${u.info?.version ?? ''} is ready to install`
            : u.state === 'error' ? 'Could not check for updates'
            : u.state === 'unsupported' ? 'Updates are turned off in this build'
            : "You're up to date";
          const detail = !isDesktop ? 'This copy runs in a web browser. Install Meridian IAM Range to get automatic updates.'
            : u.state === 'error' ? (u.error ?? 'Unknown error')
            : `${PRODUCT.name} ${appVersion}${u.lastCheck ? `. Last checked: ${new Date(u.lastCheck).toLocaleString()}` : ''}`;
          return h('div', { class: 'ws-stack' },
            h('div', { class: 'ws-hero small' }, h('span', { class: `mdl ws-update-icon ${busy ? 'spin' : ''}` }, busy ? '' : u.state === 'error' ? '' : ''), h('div', null, h('strong', null, headline), h('span', null, detail))),
            h('div', { class: 'row' },
              u.state === 'downloaded' ? button('Restart now', installUpdate, 'btn primary') : button(isDesktop ? 'Check for updates' : 'Download the installer', checkForUpdates, 'btn primary')),
            card('', 'How updates work', 'The installed app checks GitHub Releases when it starts and every six hours, downloads new versions in the background, and installs them when you restart. Your world, settings and career record are kept.', null),
            card('', 'Release notes', PRODUCT_RELEASES_URL, null, () => window.open(PRODUCT_RELEASES_URL, '_blank', 'noopener,noreferrer')));
        }
        case 'lab': {
          const model = h('select', { class: 'input ws-select', 'aria-label': 'Model', disabled: ai.status !== 'online', onChange: (e: Event) => chooseModel((e.target as HTMLSelectElement).value || null) },
            h('option', { value: '' }, `Automatic (${ai.model ?? 'none'})`), ai.models.map((m) => h('option', { value: m.name, selected: s.model === m.name }, m.cloud ? `${m.name} (cloud-hosted)` : m.name)));
          return h('div', { class: 'ws-stack' },
            card('', 'IAM Copilot (Ollama)', !y.localAi ? 'Turned off in Privacy & security' : ai.status === 'online' ? `Answering with ${ai.model}` : ai.status === 'checking' ? 'Checking...' : 'Not answering: start Ollama and run "ollama pull llama3.2"', button('Check again', () => void refreshAi(), 'btn')),
            card('', 'Model', 'The automatic choice never picks cloud-hosted models', model),
            card('', 'Proactive coaching', 'Copilot speaks up when an action breaks a control in your lab', toggle(s.copilotNudges !== false, 'Proactive coaching', (v) => { s.copilotNudges = v; persist(); draw(); })),
            card('', 'Reword new tickets', 'Rewritten in the caller\'s voice; rejected unless every fact survives', toggle(s.rewordTickets, 'Reword', (v) => { s.rewordTickets = v; persist(); draw(); })),
            card('', 'Background sync', 'Entra Connect every 30 minutes, Okta import hourly', toggle(s.autoSync, 'Background sync', (v) => { s.autoSync = v; persist(); draw(); })),
            group('Start over', h('p', { class: 'muted' }, 'Rebuild Meridian Health System with new random details. Your career record is kept.'),
              h('div', { class: 'row' }, button('Reset the company', () => { if (confirm('Rebuild Meridian Health System and discard all open scenarios?')) resetWorld(); }, 'btn danger'),
                button('Clear career record', () => { if (confirm('Delete your practice history?')) { store.career = { attempts: [] }; persist(); notify(); } }, 'btn ghost'))));
        }
      }
    }

    function draw(): void {
      clear(host);
      const top = PARENT[page] ?? page;
      const searchBox = h('input', { class: 'ws-search', type: 'search', autocomplete: 'off', placeholder: 'Find a setting', value: query, 'aria-label': 'Find a setting', onInput: (e: Event) => { query = (e.target as HTMLInputElement).value; } });
      searchBox.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const q = query.toLowerCase();
        const hit = (Object.entries(TITLES) as [Page, string][]).find(([, t]) => t.toLowerCase().includes(q)) ?? NAV.find(([, t]) => t.toLowerCase().includes(q))?.slice(0, 1).map((p) => [p, ''] as [Page, string])[0];
        if (hit) go(hit[0]);
        else if (/wall|background/.test(q)) go('background');
        else if (/mouse|cursor|pointer/.test(q)) go('pointer');
        else if (/dark|light|theme|accent/.test(q)) go('colors');
        else toast(`No settings match "${query}"`);
      });
      const title = TITLES[page] ? [NAV.find((n) => n[0] === top)![1], TITLES[page]!] : [NAV.find((n) => n[0] === page)![1]];
      host.appendChild(h('div', { class: 'ws' },
        h('nav', { class: 'ws-nav', 'aria-label': 'Settings' },
          h('div', { class: 'ws-user' }, avatar(56, 'avatar'), h('div', null, h('strong', null, store.world.player.displayName), h('span', null, `${store.world.player.sam}@${store.world.ad.domain}`))),
          searchBox,
          NAV.map(([id, label, icon]) => h('button', { class: `ws-navitem ${top === id ? 'on' : ''}`, type: 'button', onClick: () => go(id) }, h('span', { class: 'mdl' }, icon), label))),
        h('main', { class: 'ws-main', 'data-keep-scroll': '' },
          h('h1', { class: 'ws-title' }, title.map((t, i) => [i ? h('span', { class: 'mdl ws-crumb' }, '') : null, i < title.length - 1 ? h('button', { class: 'ws-crumb-link', type: 'button', onClick: () => go(top) }, t) : h('span', null, t)])),
          body())));
    }
    draw();
    const unsubUpdates = onUpdateChange(() => { if (page === 'update') draw(); });
    // Redraw when a setting changes elsewhere (Quick Settings), but not while a slider here is being dragged.
    const unsubSys = onSysChange(() => { if (!(document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'range' && host.contains(document.activeElement))) draw(); });
    return { redraw: draw, dispose: () => { unsubUpdates(); unsubSys(); } };
  },
};

let mouseHook: () => void = () => {};
export function setMousePropertiesOpener(fn: () => void): void {
  mouseHook = fn;
}
function openMouseProperties(): void {
  mouseHook();
}
