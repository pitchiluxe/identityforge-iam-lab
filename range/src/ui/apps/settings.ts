/**
 * Settings, as on Windows 11: Personalization, Accessibility (mouse pointer),
 * Time & language, Accounts and the rest, plus an IAM Lab page for the
 * range's own options. Every change applies immediately, as in Windows.
 */
import { button, clear, h, toast } from '../dom.ts';
import { notify, persist, resetWorld, store } from '../store.ts';
import { ai, chooseModel, refreshAi } from '../aiState.ts';
import { appIcon } from '../icons.ts';
import { ACCENTS, type Appearance, appearance, applyAppearance, lockScreenCss, wallpaperCss } from '../theme.ts';
import { CUSTOM_WALLPAPER_KEY, DEFAULT_LOCK_SCREEN_ID, DEFAULT_WALLPAPER_ID, allWallpapers, backgroundFor } from '../wallpapers.ts';
import { generateBatch } from '../wallpaperGenerator.ts';
import { appVersion, checkForUpdates, installUpdate, isDesktop, onUpdateChange, updateStatus } from '../updates.ts';
import { PRODUCT, PRODUCT_RELEASES_URL } from '../../product.ts';
import { type AppDef, onOpenArg } from '../wm.ts';

type Page = 'home' | 'system' | 'display' | 'notifications' | 'about' | 'devices' | 'mouse' | 'network' | 'personalization' | 'background' | 'colors' | 'themes' | 'lockscreen' | 'start' | 'taskbar'
  | 'apps' | 'accounts' | 'time' | 'gaming' | 'accessibility' | 'pointer' | 'effects' | 'privacy' | 'update' | 'lab';

const NAV: [Page, string, string][] = [
  ['home', 'Home', ''], ['system', 'System', ''], ['devices', 'Bluetooth & devices', ''], ['network', 'Network & internet', ''],
  ['personalization', 'Personalization', ''], ['apps', 'Apps', ''], ['accounts', 'Accounts', ''], ['time', 'Time & language', ''],
  ['gaming', 'Gaming', ''], ['accessibility', 'Accessibility', ''], ['privacy', 'Privacy & security', ''], ['update', 'Windows Update', ''],
  ['lab', 'IAM Lab', ''],
];
const PARENT: Partial<Record<Page, Page>> = {
  display: 'system', notifications: 'system', about: 'system', mouse: 'devices', background: 'personalization', colors: 'personalization', themes: 'personalization',
  lockscreen: 'personalization', start: 'personalization', taskbar: 'personalization', pointer: 'accessibility', effects: 'accessibility',
};
const TITLES: Partial<Record<Page, string>> = { display: 'Display', notifications: 'Notifications', about: 'About', mouse: 'Mouse', background: 'Background', colors: 'Colors', themes: 'Themes', lockscreen: 'Lock screen', start: 'Start', taskbar: 'Taskbar', pointer: 'Mouse pointer and touch', effects: 'Visual effects' };

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
      switch (page) {
        case 'home':
          return h('div', { class: 'ws-stack' },
            h('div', { class: 'ws-hero', style: `background:${wallpaperCss()}` }, h('div', null, h('strong', null, 'MHS-IAM-WKS01'), h('span', null, 'Windows 11 Enterprise'))),
            card('', 'Personalization', 'Background, colors, themes, taskbar', null, () => go('personalization')),
            card('', 'Mouse pointer', 'Style, colour and size', null, () => go('pointer')),
            card('', 'Windows Update', 'You\'re up to date', null, () => go('update')),
            card('', 'IAM Lab', 'AI assistant, background sync, start over', null, () => go('lab')));
        case 'system':
          return h('div', { class: 'ws-stack' }, card('', 'Display', 'Scale, text size', null, () => go('display')), card('', 'Notifications', 'Alerts from apps and the system', null, () => go('notifications')), card('', 'About', 'Device specifications, rename this PC', null, () => go('about')));
        case 'display':
          return h('div', { class: 'ws-stack' },
            card('', 'Scale', 'Change the size of text, apps and other items', select(String(s.scale ?? 100), [['100', '100% (Recommended)'], ['110', '110%'], ['125', '125%'], ['90', '90%']], (v) => { s.scale = Number(v); persist(); document.documentElement.style.zoom = String(Number(v) / 100); }, 'Scale')),
            card('', 'Night light', 'Use warmer colours to help block blue light', toggle(!!s.nightLight, 'Night light', (v) => { s.nightLight = v; persist(); document.documentElement.style.filter = v ? 'sepia(0.25) saturate(1.1)' : ''; draw(); })));
        case 'notifications':
          return h('div', { class: 'ws-stack' }, card('', 'Notifications', 'Get notifications from apps and other senders', toggle(s.notifications !== false, 'Notifications', (v) => { s.notifications = v; persist(); draw(); })));
        case 'about':
          return h('div', { class: 'ws-stack' }, h('div', { class: 'ws-group' }, h('h3', null, 'Device specifications'),
            h('dl', { class: 'kv' }, ...([['Device name', 'MHS-IAM-WKS01'], ['Processor', 'Intel(R) Core(TM) i7-1265U @ 2.70GHz'], ['Installed RAM', '16.0 GB'], ['System type', '64-bit operating system, x64-based processor'], ['Domain', store.world.ad.domain]] as [string, string][]).flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]))),
            h('div', { class: 'ws-group' }, h('h3', null, 'Windows specifications'), h('dl', { class: 'kv' }, ...([['Edition', 'Windows 11 Enterprise'], ['Version', '23H2'], ['OS build', '22631.4317']] as [string, string][]).flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]))),
            h('p', { class: 'muted' }, 'This workstation belongs to the IdentityForge training range. Meridian Health System and everyone in it are fictional; nothing here connects to a real directory or tenant.'));
        case 'devices':
          return h('div', { class: 'ws-stack' }, card('', 'Mouse', 'Buttons, mouse pointer speed, scrolling', null, () => go('mouse')), card('', 'Keyboard', 'Shortcuts work as on Windows: Win opens Start, F5 runs a script in the ISE', null));
        case 'mouse':
          return h('div', { class: 'ws-stack' },
            card('', 'Primary mouse button', '', select('left', [['left', 'Left'], ['right', 'Right']], () => toast('Primary button kept on Left in this lab.'), 'Primary mouse button')),
            card('', 'Mouse pointer speed', '', h('input', { type: 'range', min: '1', max: '20', value: '10', 'aria-label': 'Pointer speed' })),
            card('', 'Mouse pointer', 'Change the style, colour and size', null, () => go('pointer')),
            card('', 'Additional mouse settings', 'Pointer schemes in Control Panel', null, () => openMouseProperties()));
        case 'network':
          return h('div', { class: 'ws-stack' }, h('div', { class: 'ws-hero small' }, h('div', null, h('strong', null, 'Ethernet'), h('span', null, `Connected, ${store.world.ad.domain}`))),
            card('', 'Ethernet', 'Authenticated, domain network', null), card('', 'VPN', 'Add, connect, manage', null), card('', 'Proxy', 'Proxy server for Ethernet connections', null));
        case 'personalization':
          return h('div', { class: 'ws-stack' },
            h('div', { class: 'ws-preview', style: `background:${wallpaperCss()}` }, h('div', { class: 'ws-preview-win' })),
            card('', 'Background', 'Background image, colour, slideshow', null, () => go('background')),
            card('', 'Colors', 'Accent colour, transparency effects, colour theme', null, () => go('colors')),
            card('', 'Themes', 'Install, create, manage', null, () => go('themes')),
            card('', 'Lock screen', 'Lock screen images, apps, animations', null, () => go('lockscreen')),
            card('', 'Start', 'Recent apps and items, folders', null, () => go('start')),
            card('', 'Taskbar', 'Taskbar behaviours, alignment', null, () => go('taskbar')));
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
              ? h('div', { class: 'ws-group' }, h('h3', null, 'Choose your background colour'), h('div', { class: 'ws-swatches' }, ['#004a77', '#1f1f1f', '#4a5459', '#00585b', '#5c2d91', '#7a1f1f', '#2d4f2d', '#0063b1'].map((c) => h('button', { class: `ws-swatch ${a.solidColor === c ? 'on' : ''}`, type: 'button', style: `background:${c}`, 'aria-label': c, onClick: () => setAppearance({ solidColor: c }) }))))
              : h('div', { class: 'ws-group' }, h('h3', null, 'Choose a background'),
                  picker('wall'),
                  h('div', { class: 'row' }, h('span', null, 'Choose a photo'), button('Browse photos', () => upload.click(), 'btn'), upload)),
            card('', 'Choose a fit for your desktop image', '', select(a.wallpaperFit, [['fill', 'Fill'], ['fit', 'Fit'], ['center', 'Center']], (v) => setAppearance({ wallpaperFit: v as Appearance['wallpaperFit'] }), 'Fit')));
        }
        case 'colors':
          return h('div', { class: 'ws-stack' },
            card('', 'Choose your mode', 'Change the colours that appear in Windows and your apps', select(a.mode, [['light', 'Light'], ['dark', 'Dark'], ['system', 'Custom (follow this computer)']], (v) => setAppearance({ mode: v as Appearance['mode'] }), 'Mode')),
            card('', 'Transparency effects', 'Windows and surfaces appear translucent', toggle(a.transparency, 'Transparency', (v) => setAppearance({ transparency: v }))),
            h('div', { class: 'ws-group' }, h('h3', null, 'Accent color'), h('div', { class: 'ws-swatches' }, ACCENTS.map((c) => h('button', { class: `ws-swatch ${a.accent === c ? 'on' : ''}`, type: 'button', style: `background:${c}`, 'aria-label': `Accent ${c}`, onClick: () => setAppearance({ accent: c }) }))),
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
          return h('div', { class: 'ws-stack' }, h('div', { class: 'ws-group' }, h('h3', null, 'Current theme: choose one to apply'),
            h('div', { class: 'ws-themes' }, themes.map(([name, wp, patch, bg]) => h('button', { class: 'ws-theme', type: 'button', onClick: () => { s.wallpaper = wp; setAppearance(patch); toast(`Theme applied: ${name}`, 'ok'); draw(); } },
              h('span', { class: 'ws-theme-img', style: `background:${backgroundFor(wp, 'wall')}` }, h('span', { class: 'ws-theme-win', style: `background:${bg};border-top:4px solid ${patch.accent}` })), h('span', null, name))))));
        }
        case 'lockscreen':
          return h('div', { class: 'ws-stack' },
            h('div', { class: 'ws-preview', style: `background:${lockScreenCss()}` }),
            h('div', { class: 'ws-group' }, h('h3', null, 'Personalize your lock screen'), picker('lock')),
            card('', 'Lock now', 'Sign out to the lock screen (Start > Power)', null));
        case 'start':
          return h('div', { class: 'ws-stack' },
            card('', 'Show recommended files in Start', 'Recent documents from your folders', toggle(s.startRecommended !== false, 'Recommended', (v) => { s.startRecommended = v; persist(); draw(); })));
        case 'taskbar':
          return h('div', { class: 'ws-stack' },
            card('', 'Taskbar alignment', '', select(a.taskbarAlign, [['center', 'Center'], ['left', 'Left']], (v) => setAppearance({ taskbarAlign: v as Appearance['taskbarAlign'] }), 'Taskbar alignment')),
            card('', 'Search', 'Show the search button on the taskbar', toggle(s.taskbarSearch !== false, 'Search button', (v) => { s.taskbarSearch = v; persist(); notify(); draw(); })),
            card('', 'Desktop icons', 'Show desktop icons', toggle(a.showDesktopIcons, 'Desktop icons', (v) => setAppearance({ showDesktopIcons: v }))),
            card('', 'Desktop icon size', '', select(a.iconSize, [['small', 'Small icons'], ['medium', 'Medium icons'], ['large', 'Large icons']], (v) => setAppearance({ iconSize: v as Appearance['iconSize'] }), 'Icon size')));
        case 'apps':
          return h('div', { class: 'ws-stack' }, h('div', { class: 'ws-group' }, h('h3', null, 'Installed apps'),
            ...([['Active Directory Users and Computers (RSAT)', '10.0.22621'], ['Google Chrome', '129.0.6668.90'], ['Microsoft Edge WebView2 Runtime', '129.0.2792.79'], ['Windows PowerShell ISE', '10.0.22621'], ['Microsoft Graph PowerShell SDK', '2.25.0'], ['Microsoft Entra Connect Sync tools (remote)', '2.4.21.0'], ['IAM Coach', '1.0'], ['Notepad', '11.2409.9.0']] as [string, string][])
              .map(([n, v]) => h('div', { class: 'ws-app' }, h('span', null, n), h('span', { class: 'muted' }, v)))));
        case 'accounts':
          return h('div', { class: 'ws-stack' },
            h('div', { class: 'ws-hero small' }, appIcon('user', 56), h('div', null, h('strong', null, store.world.player.displayName), h('span', null, `${store.world.ad.netbios}\\${store.world.player.sam}`), h('span', null, 'IAM Engineer, domain account'))),
            card('', 'Your info', `Admin account for changes: ${store.world.player.adminSam}`, null),
            card('', 'Sign-in options', 'Password: workstation sign-in uses the lab password (Settings > About)', null),
            card('', 'Access work or school', `Connected to ${store.world.company.name} Active Directory domain`, null));
        case 'time':
          return h('div', { class: 'ws-stack' },
            card('', 'Current time', new Date().toLocaleString(), null),
            card('', 'Use 24-hour clock in the taskbar', '', toggle(a.clock24, '24-hour clock', (v) => setAppearance({ clock24: v }))),
            card('', 'Time zone', Intl.DateTimeFormat().resolvedOptions().timeZone, null));
        case 'gaming':
          return h('div', { class: 'ws-stack' }, card('', 'Game Mode', 'Disabled by your organization', null));
        case 'accessibility':
          return h('div', { class: 'ws-stack' }, card('', 'Mouse pointer and touch', 'Style, colour, size', null, () => go('pointer')), card('', 'Visual effects', 'Transparency and animation', null, () => go('effects')), card('', 'Text size', 'Use Display > Scale', null, () => go('display')));
        case 'pointer': {
          const styles: [Appearance['pointerStyle'], string, string, string][] = [['white', 'White', '#fff', '#000'], ['black', 'Black', '#000', '#fff'], ['inverted', 'Inverted', 'linear-gradient(135deg,#fff 50%,#000 50%)', '#666'], ['custom', 'Custom', a.pointerColor, '#000']];
          return h('div', { class: 'ws-stack' },
            h('div', { class: 'ws-group' }, h('h3', null, 'Mouse pointer style'),
              h('div', { class: 'ws-pointers' }, styles.map(([id, label, fill, stroke]) => h('button', { class: `ws-pointer ${a.pointerStyle === id ? 'on' : ''}`, type: 'button', 'aria-label': label, title: label, onClick: () => setAppearance({ pointerStyle: id }) },
                h('span', { class: 'ws-pointer-glyph', style: `background:${fill};outline:1.5px solid ${stroke}` }), h('span', null, label)))),
              a.pointerStyle === 'custom' ? h('div', null, h('p', { class: 'muted' }, 'Recommended colours'),
                h('div', { class: 'ws-swatches' }, ['#7cfc00', '#ff2d95', '#00e5ff', '#ffd400', '#ff6a00', '#a259ff'].map((c) => h('button', { class: `ws-swatch ${a.pointerColor === c ? 'on' : ''}`, type: 'button', style: `background:${c}`, 'aria-label': c, onClick: () => setAppearance({ pointerColor: c }) })),
                  h('input', { type: 'color', value: a.pointerColor, 'aria-label': 'Choose another colour', onChange: (e: Event) => setAppearance({ pointerColor: (e.target as HTMLInputElement).value }) }))) : null),
            h('div', { class: 'ws-group' }, h('h3', null, 'Size'), h('input', { type: 'range', min: '1', max: '4', step: '1', value: String(a.pointerSize), 'aria-label': 'Pointer size', style: 'width:min(360px,100%)', onInput: (e: Event) => setAppearance({ pointerSize: Number((e.target as HTMLInputElement).value) }) })),
            card('', 'Additional mouse settings', 'Pointer schemes in Control Panel', null, () => openMouseProperties()));
        }
        case 'effects':
          return h('div', { class: 'ws-stack' },
            card('', 'Transparency effects', '', toggle(a.transparency, 'Transparency', (v) => setAppearance({ transparency: v }))),
            card('', 'Animation effects', '', toggle(a.animations, 'Animation', (v) => setAppearance({ animations: v }))));
        case 'privacy':
          return h('div', { class: 'ws-stack' }, card('', 'Windows Security', 'Antivirus, firewall and device protection: managed by your organization', null), card('', 'Location', 'Off', null), card('', 'Microphone', 'Off', null));
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
            h('div', { class: 'ws-hero small' }, h('span', { class: `mdl ws-update-icon ${busy ? 'spin' : ''}` }, busy ? '\uE895' : u.state === 'error' ? '\uE7BA' : '\uE930'), h('div', null, h('strong', null, headline), h('span', null, detail))),
            h('div', { class: 'row' },
              u.state === 'downloaded' ? button('Restart now', installUpdate, 'btn primary') : button(isDesktop ? 'Check for updates' : 'Download the installer', checkForUpdates, 'btn primary')),
            card('\uE946', 'How updates work', 'The installed app checks GitHub Releases when it starts and every six hours, downloads new versions in the background, and installs them when you restart. Your world, settings and career record are kept.', null),
            card('\uE8A7', 'Release notes', PRODUCT_RELEASES_URL, null, () => window.open(PRODUCT_RELEASES_URL, '_blank', 'noopener,noreferrer')));
        }
        case 'lab': {
          const model = h('select', { class: 'input ws-select', 'aria-label': 'Model', disabled: ai.status !== 'online', onChange: (e: Event) => chooseModel((e.target as HTMLSelectElement).value || null) },
            h('option', { value: '' }, `Automatic (${ai.model ?? 'none'})`), ai.models.map((m) => h('option', { value: m.name, selected: s.model === m.name }, m.cloud ? `${m.name} (cloud-hosted)` : m.name)));
          return h('div', { class: 'ws-stack' },
            card('', 'IAM Copilot (Ollama)', ai.status === 'online' ? `Answering with ${ai.model}` : ai.status === 'checking' ? 'Checking...' : 'Not answering: start Ollama and run "ollama pull llama3.2"', button('Check again', () => void refreshAi(), 'btn')),
            card('', 'Model', 'The automatic choice never picks cloud-hosted models', model),
            card('', 'Proactive coaching', 'Copilot speaks up when an action breaks a control in your lab', toggle(s.copilotNudges !== false, 'Proactive coaching', (v) => { s.copilotNudges = v; persist(); draw(); })),
            card('', 'Reword new tickets', 'Rewritten in the caller\'s voice; rejected unless every fact survives', toggle(s.rewordTickets, 'Reword', (v) => { s.rewordTickets = v; persist(); draw(); })),
            card('', 'Background sync', 'Entra Connect every 30 minutes, Okta import hourly', toggle(s.autoSync, 'Background sync', (v) => { s.autoSync = v; persist(); draw(); })),
            h('div', { class: 'ws-group' }, h('h3', null, 'Start over'), h('p', { class: 'muted' }, 'Rebuild Meridian Health System with new random details. Your career record is kept.'),
              h('div', { class: 'row' }, button('Reset the company', () => { if (confirm('Rebuild Meridian Health System and discard all open scenarios?')) resetWorld(); }, 'btn danger'),
                button('Clear career record', () => { if (confirm('Delete your practice history?')) { store.career = { attempts: [] }; persist(); notify(); } }, 'btn ghost'))));
        }
      }
    }

    function draw(): void {
      clear(host);
      const top = PARENT[page] ?? page;
      const searchBox = h('input', { class: 'ws-search', type: 'search', placeholder: 'Find a setting', value: query, 'aria-label': 'Find a setting', onInput: (e: Event) => { query = (e.target as HTMLInputElement).value; } });
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
          h('div', { class: 'ws-user' }, appIcon('user', 56), h('div', null, h('strong', null, store.world.player.displayName), h('span', null, `${store.world.player.sam}@${store.world.ad.domain}`))),
          searchBox,
          NAV.map(([id, label, icon]) => h('button', { class: `ws-navitem ${top === id ? 'on' : ''}`, type: 'button', onClick: () => go(id) }, h('span', { class: 'mdl' }, icon), label))),
        h('main', { class: 'ws-main', 'data-keep-scroll': '' },
          h('h1', { class: 'ws-title' }, title.map((t, i) => [i ? h('span', { class: 'mdl ws-crumb' }, '') : null, i < title.length - 1 ? h('button', { class: 'ws-crumb-link', type: 'button', onClick: () => go(top) }, t) : h('span', null, t)])),
          body())));
    }
    draw();
    const unsubUpdates = onUpdateChange(() => { if (page === 'update') draw(); });
    return { redraw: draw, dispose: unsubUpdates };
  },
};

let mouseHook: () => void = () => {};
export function setMousePropertiesOpener(fn: () => void): void {
  mouseHook = fn;
}
function openMouseProperties(): void {
  mouseHook();
}
