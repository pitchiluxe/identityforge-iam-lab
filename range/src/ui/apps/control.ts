/**
 * The classic Control Panel and its Mouse Properties applet.
 */
import { clear, h } from '../dom.ts';
import { store } from '../store.ts';
import { appIcon, glyph } from '../icons.ts';
import { appearance, type Appearance } from '../theme.ts';
import { type AppDef, onOpenArg } from '../wm.ts';
import { setAppearance } from './settings.ts';

type CpPage = 'home' | 'system' | 'admin' | 'appearance' | 'clock' | 'programs' | 'users' | 'hardware';

let launch: (what: string) => void = () => {};
export function setControlPanelLauncher(fn: (what: string) => void): void {
  launch = fn;
}

const SCHEMES: [string, Partial<Appearance>][] = [
  ['Windows Default (system scheme)', { pointerStyle: 'white', pointerSize: 1 }],
  ['Windows Default (large) (system scheme)', { pointerStyle: 'white', pointerSize: 3 }],
  ['Windows Default (extra large) (system scheme)', { pointerStyle: 'white', pointerSize: 4 }],
  ['Windows Black (system scheme)', { pointerStyle: 'black', pointerSize: 1 }],
  ['Windows Black (large) (system scheme)', { pointerStyle: 'black', pointerSize: 3 }],
  ['Windows Inverted (system scheme)', { pointerStyle: 'inverted', pointerSize: 1 }],
  ['Windows Inverted (large) (system scheme)', { pointerStyle: 'inverted', pointerSize: 3 }],
  ['Windows Standard (custom colour)', { pointerStyle: 'custom', pointerSize: 2 }],
];

/** Mouse Properties: the Pointers tab and Pointer Options, as in main.cpl. */
export function openMouseProperties(): void {
  const before = appearance();
  let tab: 'buttons' | 'pointers' | 'options' = 'pointers';
  let pending: Partial<Appearance> = {};
  const shield = h('div', { class: 'mm-shield', style: 'position:fixed;z-index:100000' });
  const body = h('div', { class: 'mm-dlg-body' });
  const close = (): void => shield.remove();
  const current = (): Appearance => ({ ...before, ...pending });
  const draw = (): void => {
    clear(body);
    const a = current();
    const scheme = SCHEMES.find(([, p]) => p.pointerStyle === a.pointerStyle && p.pointerSize === a.pointerSize)?.[0] ?? '(None)';
    body.appendChild(h('div', { class: 'mm-tabrow' }, (['buttons', 'pointers', 'options'] as const).map((t) => h('div', { class: `mm-tab ${tab === t ? 'sel' : ''}`, onClick: () => { tab = t; draw(); } }, t === 'buttons' ? 'Buttons' : t === 'pointers' ? 'Pointers' : 'Pointer Options'))));
    if (tab === 'pointers') {
      body.appendChild(h('div', { class: 'mm-tabpanel', style: 'min-height:300px' },
        h('fieldset', { class: 'mm-fs' }, h('legend', null, 'Scheme'),
          h('select', { onChange: (e: Event) => { const s = SCHEMES.find(([n]) => n === (e.target as HTMLSelectElement).value); if (s) { pending = { ...pending, ...s[1] }; draw(); } } },
            h('option', { selected: scheme === '(None)' }, '(None)'), SCHEMES.map(([n]) => h('option', { selected: n === scheme }, n)))),
        h('div', null, 'Customize:'),
        h('div', { class: 'mm-lb', style: 'height:180px' }, ...['Normal Select', 'Help Select', 'Working in Background', 'Busy', 'Precision Select', 'Text Select', 'Handwriting', 'Unavailable', 'Link Select'].map((n, i) => h('div', { class: 'cp-cursor-row' }, h('span', null, n), h('span', { class: 'cp-cursor', style: `background:${a.pointerStyle === 'black' ? '#000' : a.pointerStyle === 'custom' ? a.pointerColor : '#fff'};width:${10 + a.pointerSize * 3}px;height:${14 + a.pointerSize * 4}px;${i === 5 ? 'width:3px' : ''}` })))),
        h('div', { class: 'mm-chk' }, h('input', { type: 'checkbox', id: 'cp-shadow', checked: true }), h('label', { for: 'cp-shadow' }, 'Enable pointer shadow'))));
    } else if (tab === 'options') {
      body.appendChild(h('div', { class: 'mm-tabpanel', style: 'min-height:300px' },
        h('fieldset', { class: 'mm-fs' }, h('legend', null, 'Motion'), 'Select a pointer speed:', h('input', { type: 'range', min: '1', max: '20', value: '10' }), h('div', { class: 'mm-chk' }, h('input', { type: 'checkbox', id: 'cp-prec', checked: true }), h('label', { for: 'cp-prec' }, 'Enhance pointer precision'))),
        h('fieldset', { class: 'mm-fs' }, h('legend', null, 'Visibility'), h('div', { class: 'mm-chk' }, h('input', { type: 'checkbox', id: 'cp-hide', checked: true }), h('label', { for: 'cp-hide' }, 'Hide pointer while typing')))));
    } else {
      body.appendChild(h('div', { class: 'mm-tabpanel', style: 'min-height:300px' },
        h('fieldset', { class: 'mm-fs' }, h('legend', null, 'Button configuration'), h('div', { class: 'mm-chk' }, h('input', { type: 'checkbox', id: 'cp-swap', disabled: true }), h('label', { for: 'cp-swap' }, 'Switch primary and secondary buttons'))),
        h('fieldset', { class: 'mm-fs' }, h('legend', null, 'Double-click speed'), h('input', { type: 'range', min: '1', max: '10', value: '5' }))));
    }
  };
  shield.appendChild(h('div', { class: 'mm-dlg', style: 'width:min(420px, calc(100% - 16px))' },
    h('div', { class: 'mm-dlg-title' }, glyph('properties'), h('span', { class: 't' }, 'Mouse Properties'), h('button', { class: 'mm-dlg-x', type: 'button', onClick: close }, '✕')),
    body,
    h('div', { class: 'mm-dlg-foot' },
      h('button', { class: 'mm-btn default', type: 'button', onClick: () => { setAppearance(pending); close(); } }, 'OK'),
      h('button', { class: 'mm-btn', type: 'button', onClick: close }, 'Cancel'),
      h('button', { class: 'mm-btn', type: 'button', onClick: () => setAppearance(pending) }, 'Apply'))));
  draw();
  document.body.appendChild(shield);
}

function dateTimeDialog(): void {
  const shield = h('div', { class: 'mm-shield', style: 'position:fixed;z-index:100000' });
  const close = (): void => shield.remove();
  const now = new Date();
  shield.appendChild(h('div', { class: 'mm-dlg', style: 'width:min(400px, calc(100% - 16px))' },
    h('div', { class: 'mm-dlg-title' }, h('span', { class: 't' }, 'Date and Time'), h('button', { class: 'mm-dlg-x', type: 'button', onClick: close }, '✕')),
    h('div', { class: 'mm-dlg-body' }, h('div', { class: 'mm-tabpanel', style: 'min-height:0' },
      h('p', null, `Date: ${now.toLocaleDateString(undefined, { dateStyle: 'full' })}`), h('p', null, `Time: ${now.toLocaleTimeString()}`),
      h('fieldset', { class: 'mm-fs' }, h('legend', null, 'Time zone'), Intl.DateTimeFormat().resolvedOptions().timeZone),
      h('p', { class: 'muted' }, 'Time is synchronized with MHS-DC01.meridianhealth.test. Kerberos needs clocks within 5 minutes of the DC.'))),
    h('div', { class: 'mm-dlg-foot' }, h('button', { class: 'mm-btn default', type: 'button', onClick: close }, 'OK'))));
  document.body.appendChild(shield);
}

export const controlPanelApp: AppDef = {
  id: 'control',
  title: 'Control Panel',
  icon: 'control',
  width: 900,
  height: 600,
  mount(host, win) {
    let page: CpPage = 'home';
    onOpenArg(win, (p) => { if (p) { page = p as CpPage; draw(); } });
    const go = (p: CpPage): void => { page = p; draw(); };
    const link = (label: string, fn: () => void): HTMLElement => h('a', { href: '#', class: 'cp-link', onClick: (e: Event) => { e.preventDefault(); fn(); } }, label);
    const category = (icon: Parameters<typeof appIcon>[0], title: string, open: () => void, links: [string, () => void][]): HTMLElement =>
      h('div', { class: 'cp-cat' }, appIcon(icon, 48), h('div', null, link(title, open), h('div', { class: 'cp-sub' }, links.map(([l, f]) => link(l, f)))));
    function body(): HTMLElement {
      switch (page) {
        case 'home':
          return h('div', null, h('h2', { class: 'cp-h' }, 'Adjust your computer\'s settings'),
            h('div', { class: 'cp-grid' },
              category('control', 'System and Security', () => go('system'), [['Review your computer\'s status', () => go('system')], ['Administrative Tools', () => go('admin')]]),
              category('network', 'Network and Internet', () => launch('settings:network'), [['View network status and tasks', () => launch('settings:network')]]),
              category('mouse', 'Hardware and Sound', () => go('hardware'), [['Mouse', openMouseProperties], ['Devices and Printers', () => go('hardware')]]),
              category('programs', 'Programs', () => go('programs'), [['Uninstall a program', () => go('programs')]]),
              category('user', 'User Accounts', () => go('users'), [['Change account type', () => go('users')]]),
              category('settings', 'Appearance and Personalization', () => launch('settings:personalization'), [['Change the theme', () => launch('settings:themes')], ['Change desktop background', () => launch('settings:background')]]),
              category('clock', 'Clock and Region', () => go('clock'), [['Change date, time, or number formats', dateTimeDialog]]),
              category('access', 'Ease of Access', () => launch('settings:pointer'), [['Change how your mouse works', () => launch('settings:pointer')]])));
        case 'system':
          return h('div', null, h('h2', { class: 'cp-h' }, 'System and Security'), h('div', { class: 'cp-list' },
            link('Security and Maintenance', () => launch('settings:privacy')), link('Windows Defender Firewall', () => launch('settings:privacy')),
            link('System', () => launch('settings:about')), link('Windows Tools / Administrative Tools', () => go('admin')), link('Event Viewer', () => launch('eventvwr'))));
        case 'admin':
          return h('div', null, h('h2', { class: 'cp-h' }, 'Windows Tools'), h('div', { class: 'cp-tools' },
            ...([['aduc', 'Active Directory Users and Computers', 'dsa.msc'], ['eventviewer', 'Event Viewer', 'eventvwr'], ['powershell', 'Windows PowerShell', 'powershell'], ['powershell', 'Windows PowerShell ISE', 'ise'], ['explorer', 'File Explorer', 'explorer'], ['notepad', 'Notepad', 'notepad'], ['control', 'Control Panel', 'control']] as [Parameters<typeof appIcon>[0], string, string][])
              .map(([icon, label, cmd]) => h('button', { class: 'cp-tool', type: 'button', onDblclick: () => launch(cmd), onKeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') launch(cmd); } }, appIcon(icon, 40), h('span', null, label)))));
        case 'hardware':
          return h('div', null, h('h2', { class: 'cp-h' }, 'Hardware and Sound'), h('div', { class: 'cp-list' }, link('Mouse', openMouseProperties), link('Devices and Printers', () => launch('settings:devices')), link('Display', () => launch('settings:display'))));
        case 'programs':
          return h('div', null, h('h2', { class: 'cp-h' }, 'Programs and Features'), h('p', { class: 'muted' }, 'To uninstall a program, select it from the list. Uninstall is restricted by your organization.'),
            h('table', { class: 'grid' }, h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Publisher'), h('th', null, 'Version'))),
              h('tbody', null, ([['Google Chrome', 'Google LLC', '129.0.6668.90'], ['Microsoft Edge WebView2 Runtime', 'Microsoft Corporation', '129.0.2792.79'], ['Remote Server Administration Tools', 'Microsoft Corporation', '10.0.22621'], ['Microsoft Graph PowerShell SDK', 'Microsoft Corporation', '2.25.0'], ['Ollama', 'Ollama', 'local']] as string[][]).map((r) => h('tr', null, r.map((c) => h('td', null, c)))))));
        case 'users':
          return h('div', null, h('h2', { class: 'cp-h' }, 'User Accounts'), h('div', { class: 'cp-cat' }, appIcon('user', 64), h('div', null, h('strong', null, store.world.player.displayName), h('div', { class: 'muted' }, `${store.world.ad.netbios}\\${store.world.player.sam}, Domain user`), h('div', { class: 'muted' }, `Administrative work runs as ${store.world.ad.netbios}\\${store.world.player.adminSam}`))));
        case 'clock':
          return h('div', null, h('h2', { class: 'cp-h' }, 'Clock and Region'), h('div', { class: 'cp-list' }, link('Date and Time', dateTimeDialog), link('Change date, time, or number formats', () => launch('settings:time'))));
        default:
          launch('settings:personalization');
          page = 'home';
          return body();
      }
    }
    function draw(): void {
      clear(host);
      const crumbs: [string, CpPage][] = page === 'home' ? [['Control Panel', 'home']] : [['Control Panel', 'home'], [{ system: 'System and Security', admin: 'Windows Tools', appearance: 'Appearance and Personalization', clock: 'Clock and Region', programs: 'Programs and Features', users: 'User Accounts', hardware: 'Hardware and Sound', home: '' }[page], page]];
      host.appendChild(h('div', { class: 'cp' },
        h('div', { class: 'fx-addr' },
          h('button', { class: 'fx-nav', type: 'button', title: 'Back', disabled: page === 'home', onClick: () => go('home') }, ''),
          h('div', { class: 'fx-crumbs' }, crumbs.map(([t, p], i) => [i ? h('span', { class: 'fx-chev' }, '') : null, h('button', { class: 'fx-crumb', type: 'button', onClick: () => go(p) }, t)])),
          h('input', { class: 'fx-search', type: 'search', placeholder: 'Search Control Panel', 'aria-label': 'Search Control Panel', onKeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') { const q = (e.target as HTMLInputElement).value.toLowerCase(); if (/mouse|pointer|cursor/.test(q)) openMouseProperties(); else if (/admin|tool/.test(q)) go('admin'); else if (/program|uninstall/.test(q)) go('programs'); else launch('settings:home'); } } })),
        h('div', { class: 'cp-body', 'data-keep-scroll': '' }, body())));
      win.setTitle(crumbs.at(-1)![0]);
    }
    draw();
    return { redraw: draw };
  },
};
