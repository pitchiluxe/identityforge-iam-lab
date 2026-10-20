/**
 * ui/apps/security.ts — Windows Security, as on Windows 11.
 *
 * Home ("Security at a glance"), Virus & threat protection with a working
 * Quick/Full/Custom scan over the virtual disk (world/defender.ts), threat
 * actions (quarantine, allow, restore) and Protection history, Account
 * protection, Firewall & network protection with per-profile switches,
 * App & browser control, Device security and Device performance & health.
 * Settings an enterprise locks down say so, as they do on a managed PC.
 */
import { clear, h, toast } from '../dom.ts';
import { act, persist, store } from '../store.ts';
import { type AppDef, onOpenArg, openApp } from '../wm.ts';
import { settingsApp } from './settings.ts';
import { type Finding, scanFiles } from '../../world/defender.ts';
import { deleteFile, homeDir, restoreFile } from '../../world/docs.ts';
import { openFromShell } from './tools.ts';
import { fmtDate, fmtTime, playSound, signInPassword, sys, DEFAULT_SIGN_IN_PASSWORD } from '../system.ts';

type Page = 'home' | 'virus' | 'account' | 'firewall' | 'app' | 'device' | 'health' | 'history';

export interface SecurityState {
  lastScan?: { time: string; scope: string; files: number; threats: number };
  history: { time: string; name: string; path: string; severity: string; action: 'Quarantined' | 'Allowed' | 'Restored' | 'Active' }[];
  allowed: string[];
  firewall: { private: boolean; public: boolean };
  notifications: boolean;
}

function state(): SecurityState {
  const s = store.settings.security ?? { history: [], allowed: [], firewall: { private: true, public: true }, notifications: true };
  store.settings.security = s;
  return s;
}

const NAV: [Page, string, string][] = [
  ['home', 'Home', ''],
  ['virus', 'Virus & threat protection', ''],
  ['account', 'Account protection', ''],
  ['firewall', 'Firewall & network protection', ''],
  ['app', 'App & browser control', ''],
  ['device', 'Device security', ''],
  ['health', 'Device performance & health', ''],
  ['history', 'Protection history', ''],
];

export const securityApp: AppDef = {
  id: 'security',
  title: 'Windows Security',
  icon: 'security',
  width: 1000,
  height: 680,
  mount(host, win) {
    let page: Page = (win.arg as Page) || 'home';
    let scanning: { scope: string; done: number; total: number; current: string; timer: number } | null = null;
    let results: Finding[] | null = null;
    let scope: 'quick' | 'full' | 'custom' = 'quick';
    let customFolder = `${homeDir(store.world)}\\Downloads`;
    onOpenArg(win, (p) => { if (p) { page = p as Page; draw(); } });
    const go = (p: Page): void => { page = p; draw(); };

    const active = (): Finding[] => (results ?? []).filter((f) => !state().allowed.includes(f.path) && store.world.files.some((x) => x.path === f.path && !x.deleted));
    const status = (ok: boolean, text: string): HTMLElement => h('span', { class: `sec-status ${ok ? 'ok' : 'warn'}` }, h('span', { class: 'mdl' }, ok ? '' : ''), text);
    const section = (icon: string, title: string, desc: string, ...body: (HTMLElement | null)[]): HTMLElement =>
      h('section', { class: 'sec-section' }, h('div', { class: 'sec-sec-head' }, h('span', { class: 'mdl sec-sec-icon' }, icon), h('div', null, h('h2', null, title), h('p', null, desc))), ...body);
    const managed = (text = 'This setting is managed by your administrator.'): HTMLElement => h('p', { class: 'sec-managed' }, h('span', { class: 'mdl' }, ''), text);
    const toggle = (on: boolean, label: string, onChange: ((v: boolean) => void) | null): HTMLElement =>
      h('label', { class: `ws-toggle ${onChange ? '' : 'disabled'}` }, h('span', { class: 'ws-toggle-text' }, on ? 'On' : 'Off'),
        h('input', { type: 'checkbox', role: 'switch', checked: on, disabled: !onChange, 'aria-label': label, onChange: (e: Event) => onChange?.((e.target as HTMLInputElement).checked) }), h('span', { class: 'ws-switch' }));
    const link = (label: string, fn: () => void): HTMLButtonElement => h('button', { class: 'sec-link', type: 'button', onClick: fn }, label);

    function startScan(kind: 'quick' | 'full' | 'custom'): void {
      if (scanning) return;
      const files = store.world.files.filter((f) => !f.deleted && (kind === 'full' || (kind === 'custom' ? f.path.toLowerCase().startsWith(`${customFolder.toLowerCase()}\\`) : /\\(Desktop|Downloads|Documents|AppData)\\/i.test(f.path))));
      const label = kind === 'quick' ? 'Quick scan' : kind === 'full' ? 'Full scan' : `Custom scan (${customFolder.replace(homeDir(store.world) + '\\', '')})`;
      scanning = { scope: label, done: 0, total: Math.max(files.length, 1), current: '', timer: 0 };
      results = null;
      const step = Math.max(1, Math.ceil(files.length / 40));
      scanning.timer = window.setInterval(() => {
        if (!scanning) return;
        scanning.done = Math.min(scanning.total, scanning.done + step);
        scanning.current = files[scanning.done - 1]?.path ?? '';
        if (scanning.done >= scanning.total) {
          clearInterval(scanning.timer);
          const found = scanFiles(store.world.files, kind === 'full' ? 'full' : 'quick', kind === 'custom' ? customFolder : undefined).filter((f) => !state().allowed.includes(f.path));
          results = found;
          const s = state();
          s.lastScan = { time: new Date().toISOString(), scope: label, files: files.length, threats: found.length };
          for (const f of found) s.history.unshift({ time: new Date().toISOString(), name: f.name, path: f.path, severity: f.severity, action: 'Active' });
          s.history.splice(100);
          persist();
          scanning = null;
          if (found.length) { if (state().notifications) toast(`Windows Security: ${found.length} threat${found.length === 1 ? '' : 's'} found. Start the recommended actions.`, 'err'); }
          else { playSound('notify'); toast('Windows Security: no current threats.', 'ok'); }
        }
        draw();
      }, 60);
      draw();
    }

    const record = (f: Finding, action: SecurityState['history'][number]['action']): void => {
      const s = state();
      const entry = s.history.find((x) => x.path === f.path && x.name === f.name && x.action === 'Active');
      if (entry) { entry.action = action; entry.time = new Date().toISOString(); }
      else s.history.unshift({ time: new Date().toISOString(), name: f.name, path: f.path, severity: f.severity, action });
      persist();
    };
    const quarantine = (f: Finding): void => { if (act((w) => deleteFile(w, f.path))) { record(f, 'Quarantined'); toast(`Quarantined: ${f.path.split('\\').pop()}`, 'ok'); draw(); } };
    const allow = (f: Finding): void => { const s = state(); if (!s.allowed.includes(f.path)) s.allowed.push(f.path); record(f, 'Allowed'); draw(); };

    function threatList(list: Finding[]): HTMLElement {
      return h('div', { class: 'sec-threats' },
        list.map((f) => h('div', { class: `sec-threat ${f.severity.toLowerCase()}` },
          h('div', { class: 'sec-threat-head' }, h('strong', null, f.name), h('span', { class: 'sec-sev' }, f.severity)),
          h('div', { class: 'sec-threat-path' }, f.path),
          h('p', null, f.detail),
          h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onClick: () => quarantine(f) }, 'Quarantine'), h('button', { class: 'btn', type: 'button', onClick: () => allow(f) }, 'Allow on device'), link('Open file location', () => openFromShell(`explorer:${f.path.slice(0, f.path.lastIndexOf('\\'))}`))))),
        list.length > 1 ? h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onClick: () => { for (const f of list) quarantine(f); } }, 'Start actions')) : null);
    }

    function body(): HTMLElement {
      const s = state();
      const threats = active();
      const fw = s.firewall;
      const fwOk = fw.private && fw.public;
      const pwChanged = !!sys().signInPassword;
      switch (page) {
        case 'home': {
          const tile = (p: Page, icon: string, title: string, ok: boolean, text: string): HTMLElement =>
            h('button', { class: `sec-tile ${ok ? '' : 'warn'}`, type: 'button', onClick: () => go(p) }, h('span', { class: 'mdl sec-tile-icon' }, icon), h('strong', null, title), status(ok, text));
          return h('div', { class: 'sec-home' },
            h('div', { class: 'sec-hero' }, h('span', { class: 'mdl' }, threats.length || !fwOk || !pwChanged ? '' : ''), h('div', null, h('h1', null, 'Security at a glance'), h('p', null, threats.length || !fwOk || !pwChanged ? 'Some protection areas need your attention.' : 'See what\'s happening with the security and health of your device and take any actions needed.'))),
            h('div', { class: 'sec-tiles' },
              tile('virus', '', 'Virus & threat protection', !threats.length, threats.length ? `${threats.length} threat${threats.length === 1 ? '' : 's'} found. Actions recommended.` : 'No action needed.'),
              tile('account', '', 'Account protection', pwChanged, pwChanged ? 'No action needed.' : 'The default sign-in password is still in use.'),
              tile('firewall', '', 'Firewall & network protection', fwOk, fwOk ? 'No action needed.' : 'A firewall profile is turned off.'),
              tile('app', '', 'App & browser control', true, 'No action needed.'),
              tile('device', '', 'Device security', true, 'View status and manage hardware security features.'),
              tile('health', '', 'Device performance & health', true, 'No action needed.')));
        }
        case 'virus': {
          const last = s.lastScan;
          const scope2 = (id: 'quick' | 'full' | 'custom', title: string, desc: string): HTMLElement =>
            h('label', { class: 'sec-radio' }, h('input', { type: 'radio', name: 'scan', checked: scope === id, onChange: () => { scope = id; draw(); } }), h('span', null, h('strong', null, title), h('small', null, desc)));
          return h('div', null,
            section('', 'Virus & threat protection', 'Protection for your device against threats.'),
            h('div', { class: 'sec-card' },
              h('h3', null, 'Current threats'),
              scanning
                ? h('div', { class: 'sec-scan' }, h('strong', null, `${scanning.scope} in progress...`), h('div', { class: 'sec-meter' }, h('span', { style: `width:${Math.round((scanning.done / scanning.total) * 100)}%` })), h('small', null, `${scanning.done} of ${scanning.total} files scanned`), h('small', { class: 'sec-current' }, scanning.current))
                : threats.length ? threatList(threats)
                  : h('div', null, h('p', null, 'No current threats.'), last ? h('p', { class: 'muted' }, `Last scan: ${fmtDate(new Date(last.time), 'long')} ${fmtTime(new Date(last.time))} (${last.scope}). ${last.threats} threat${last.threats === 1 ? '' : 's'} found. ${last.files} files scanned.`) : h('p', { class: 'muted' }, 'No scan has been run yet.')),
              h('div', { class: 'sec-scan-opts' },
                scope2('quick', 'Quick scan', 'Checks folders where threats are commonly found: Desktop, Downloads, Documents, AppData.'),
                scope2('full', 'Full scan', 'Checks every file on the disk.'),
                scope2('custom', 'Custom scan', 'Choose which folder to check.'),
                scope === 'custom' ? h('input', { class: 'input', value: customFolder, 'aria-label': 'Folder to scan', onChange: (e: Event) => { customFolder = (e.target as HTMLInputElement).value.replace(/\\+$/, ''); } }) : null,
                h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', disabled: !!scanning, onClick: () => startScan(scope) }, 'Scan now'), link('Protection history', () => go('history'))))),
            h('div', { class: 'sec-card' },
              h('h3', null, 'Virus & threat protection settings'),
              h('div', { class: 'sec-row' }, h('div', null, h('strong', null, 'Real-time protection'), h('small', null, 'Locates and stops malware from installing or running on your device.')), toggle(true, 'Real-time protection', null)),
              h('div', { class: 'sec-row' }, h('div', null, h('strong', null, 'Cloud-delivered protection'), h('small', null, 'Provides increased and faster protection with access to the latest protection data in the cloud.')), toggle(true, 'Cloud-delivered protection', null)),
              h('div', { class: 'sec-row' }, h('div', null, h('strong', null, 'Tamper Protection'), h('small', null, 'Prevents others from tampering with important security features.')), toggle(true, 'Tamper Protection', null)),
              managed('These settings are managed by Meridian Health System through Microsoft Defender for Endpoint.')),
            h('div', { class: 'sec-card' },
              h('h3', null, 'Virus & threat protection updates'),
              h('p', { class: 'muted' }, `Security intelligence version: 1.419.${(new Date().getMonth() + 1) * 10 + 3}.0. Last update: ${fmtDate(new Date(), 'long')}.`),
              h('button', { class: 'btn', type: 'button', onClick: () => toast('Protection updates: security intelligence is up to date.', 'ok') }, 'Check for updates')));
        }
        case 'account':
          return h('div', null,
            section('', 'Account protection', 'Security for your account and sign-in.'),
            h('div', { class: 'sec-card' },
              h('h3', null, `${store.world.player.displayName} (${store.world.ad.netbios}\\${store.world.player.sam})`),
              h('p', null, `Work account connected to ${store.world.company.name}.`),
              h('div', { class: 'sec-row' }, h('div', null, h('strong', null, 'Sign-in password'), h('small', null, pwChanged ? 'You chose your own password.' : `The default password ${DEFAULT_SIGN_IN_PASSWORD} is still in use and is shown on the sign-in screen. Change it.`)), status(pwChanged, pwChanged ? 'Protected' : 'Action recommended')),
              h('div', { class: 'sec-row' }, h('div', null, h('strong', null, 'Lock when away'), h('small', null, sys().idleLockMinutes ? `Locks after ${sys().idleLockMinutes} minute(s) without activity.` : 'Not set: an unattended session stays open.')), status(sys().idleLockMinutes > 0, sys().idleLockMinutes ? 'On' : 'Off')),
              h('div', { class: 'row' }, link('Sign-in options', () => openApp(settingsApp, 'accounts'))),
              h('p', { class: 'muted' }, `Password length policy: 12 or more characters. The sign-in password currently has ${signInPassword().length} characters.`)));
        case 'firewall': {
          const prof = (id: 'domain' | 'private' | 'public', title: string, active: boolean): HTMLElement => {
            const on = id === 'domain' ? true : fw[id];
            return h('div', { class: 'sec-row' },
              h('div', null, h('strong', null, `${title}${active ? ' (active)' : ''}`), h('small', null, id === 'domain' ? `Connected to ${store.world.ad.domain}. Managed by Group Policy.` : on ? 'Firewall is on.' : 'Firewall is off. Your device may be vulnerable.')),
              toggle(on, `${title} firewall`, id === 'domain' ? null : (v) => { fw[id] = v; persist(); toast(`${title} firewall ${v ? 'turned on' : 'turned off'}`, v ? 'ok' : 'err'); draw(); }));
          };
          return h('div', null,
            section('', 'Firewall & network protection', 'Who and what can access your networks.'),
            h('div', { class: 'sec-card' }, prof('domain', 'Domain network', true), prof('private', 'Private network', false), prof('public', 'Public network', false),
              h('p', { class: 'muted' }, 'Turning a profile off is reported to Security Operations on a managed device. Turn it back on unless a change ticket says otherwise.')));
        }
        case 'app':
          return h('div', null,
            section('', 'App & browser control', 'App protection and online security.'),
            h('div', { class: 'sec-card' },
              h('div', { class: 'sec-row' }, h('div', null, h('strong', null, 'Reputation-based protection'), h('small', null, 'Checks apps and files against Microsoft Defender SmartScreen.')), status(true, 'On')),
              h('div', { class: 'sec-row' }, h('div', null, h('strong', null, 'Smart App Control'), h('small', null, 'Blocks untrusted or unsigned apps.')), status(true, 'Evaluation')),
              h('div', { class: 'sec-row' }, h('div', null, h('strong', null, 'Exploit protection'), h('small', null, 'Data Execution Prevention, ASLR and Control Flow Guard are on for every app.')), status(true, 'On')),
              managed()));
        case 'device':
          return h('div', null,
            section('', 'Device security', 'Security that comes built into your device.'),
            h('div', { class: 'sec-card' },
              h('div', { class: 'sec-row' }, h('div', null, h('strong', null, 'Core isolation'), h('small', null, 'Memory integrity is on: virtualization-based security protects core processes, including LSASS credential guard.')), status(true, 'On')),
              h('div', { class: 'sec-row' }, h('div', null, h('strong', null, 'Security processor'), h('small', null, 'Trusted Platform Module 2.0. BitLocker keys are sealed by the TPM.')), status(true, 'TPM 2.0')),
              h('div', { class: 'sec-row' }, h('div', null, h('strong', null, 'Secure boot'), h('small', null, 'Prevents malicious software from loading when the device starts.')), status(true, 'On')),
              h('p', { class: 'muted' }, 'Your device meets the requirements for standard hardware security.')));
        case 'health': {
          const files = store.world.files.filter((f) => !f.deleted).length;
          return h('div', null,
            section('', 'Device performance & health', 'Health report for MHS-IAM-WKS01.'),
            h('div', { class: 'sec-card' },
              h('p', { class: 'muted' }, `Last scan: ${fmtDate(new Date(), 'long')} ${fmtTime(new Date())}`),
              h('div', { class: 'sec-row' }, h('strong', null, 'Storage capacity'), status(true, `${files} files on C:. No issues.`)),
              h('div', { class: 'sec-row' }, h('strong', null, 'Battery life'), status(true, 'Plugged in. No issues.')),
              h('div', { class: 'sec-row' }, h('strong', null, 'Apps and software'), status(true, 'No issues.')),
              h('div', { class: 'sec-row' }, h('strong', null, 'Windows Time service'), status(true, `Synchronized with MHS-DC01.${store.world.ad.domain}. Kerberos needs clocks within 5 minutes.`))));
        }
        case 'history':
          return h('div', null,
            section('', 'Protection history', 'View the latest protection actions and recommendations from Windows Security.'),
            h('div', { class: 'sec-card' },
              s.history.length
                ? h('div', { class: 'sec-hist' }, s.history.map((e) => h('div', { class: `sec-hist-row ${e.action.toLowerCase()}` },
                  h('div', null, h('strong', null, e.action === 'Active' ? 'Threat found' : `Threat ${e.action.toLowerCase()}`), h('small', null, `${fmtDate(new Date(e.time), 'short')} ${fmtTime(new Date(e.time))}`)),
                  h('div', null, h('span', null, e.name), h('small', null, e.path)),
                  h('span', { class: 'sec-sev' }, e.severity),
                  e.action === 'Quarantined' ? h('button', { class: 'btn', type: 'button', onClick: () => { if (act((w) => restoreFile(w, e.path))) { e.action = 'Restored'; persist(); draw(); } } }, 'Restore')
                    : e.action === 'Allowed' ? h('button', { class: 'btn', type: 'button', onClick: () => { s.allowed = s.allowed.filter((p) => p !== e.path); e.action = 'Active'; persist(); draw(); } }, 'Don\'t allow') : h('span'))))
                : h('p', null, 'No recent protection actions. Run a scan from Virus & threat protection.'),
              s.history.length ? h('button', { class: 'btn ghost', type: 'button', onClick: () => { s.history = []; persist(); draw(); } }, 'Clear history') : null));
      }
    }

    function draw(): void {
      clear(host);
      host.appendChild(h('div', { class: 'sec' },
        h('nav', { class: 'sec-nav', 'aria-label': 'Windows Security' },
          NAV.map(([id, label, icon]) => h('button', { class: `sec-navitem ${page === id ? 'on' : ''}`, type: 'button', onClick: () => go(id) }, h('span', { class: 'mdl' }, icon), label)),
          h('div', { class: 'sec-navfoot' }, h('label', { class: 'sec-navitem' }, h('input', { type: 'checkbox', checked: state().notifications, onChange: (e: Event) => { state().notifications = (e.target as HTMLInputElement).checked; persist(); } }), 'Notify me about threats'))),
        h('main', { class: 'sec-main', 'data-keep-scroll': '' }, body())));
    }
    draw();
    return { redraw: () => { if (!scanning) draw(); }, dispose: () => { if (scanning) clearInterval(scanning.timer); } };
  },
};
