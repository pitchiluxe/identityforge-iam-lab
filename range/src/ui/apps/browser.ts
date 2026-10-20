/**
 * Google Chrome on the workstation: tabs in the title bar, the omnibox,
 * bookmarks bar, the three-dot menu, history, downloads, bookmarks, find,
 * zoom, incognito, and the shortcuts people use without thinking.
 *
 * Intranet and admin sites render inside the range. Real admin portals refuse
 * to load inside another page, so "Real portals" open in your own browser.
 */
import { clear, h, toast } from '../dom.ts';
import { persist, store } from '../store.ts';
import { appIcon } from '../icons.ts';
import { isDesktop } from '../updates.ts';
import { sys } from '../system.ts';
import { type MenuEntry, showMenu } from '../ctxmenu.ts';
import type { AppDef, WinHandle } from '../wm.ts';
import { onOpenArg, openApp } from '../wm.ts';
import type { Site, SiteCtx } from '../sites/common.ts';
import { serviceDesk } from '../sites/servicedesk.ts';
import { peopleHub, saasAdmin, webMail, wiki } from '../sites/business.ts';
import { entra } from '../sites/entra.ts';
import { okta } from '../sites/okta.ts';

export const SITES: Site[] = [serviceDesk, peopleHub, webMail, entra, okta, saasAdmin, wiki];

export const REAL_PORTALS: [string, string][] = [
  ['Microsoft Entra admin center', 'https://entra.microsoft.com'],
  ['Microsoft 365 admin center', 'https://admin.microsoft.com'],
  ['Azure portal', 'https://portal.azure.com'],
  ['Microsoft 365 Developer Program', 'https://developer.microsoft.com/microsoft-365/dev-program'],
  ['Okta developer org sign-up', 'https://developer.okta.com/signup/'],
  ['Okta Help Center', 'https://help.okta.com'],
  ['ServiceNow developer instance', 'https://developer.servicenow.com'],
  ['Microsoft Learn: ActiveDirectory module', 'https://learn.microsoft.com/powershell/module/activedirectory/'],
  ['Microsoft Learn: Entra ID', 'https://learn.microsoft.com/entra/identity/'],
  ['MITRE ATT&CK: Valid Accounts (T1078)', 'https://attack.mitre.org/techniques/T1078/'],
];

export interface BrowserData {
  history: { url: string; title: string; time: string }[];
  bookmarks: { url: string; title: string }[];
  downloads: { name: string; time: string; size: number }[];
  showBar: boolean;
}

export function browserData(): BrowserData {
  const d = store.settings.browser ?? { history: [], bookmarks: [], downloads: [], showBar: true };
  store.settings.browser = d;
  return d;
}

/** Called when the range saves a file for you (evidence exports), so it appears in Downloads. */
export function recordDownload(name: string, size: number): void {
  browserData().downloads.unshift({ name, time: new Date().toISOString(), size });
  persist();
}

interface Tab {
  url: string;
  back: string[];
  fwd: string[];
  pinned: boolean;
  zoom: number;
  /** Title reported by a real website. */
  title?: string;
  /** The live view of a real website, kept so switching tabs does not reload it. */
  frame?: HTMLElement;
}

/** A real website (not one of the range's intranet sites). */
function isWeb(url: string): boolean {
  const { site, host } = parse(url);
  return !site && /^https?:\/\//i.test(url) && !!host && !/\.(test|example|invalid|local)$/i.test(host);
}

const CHROME_TITLES: Record<string, string> = { newtab: 'New Tab', history: 'History', downloads: 'Downloads', bookmarks: 'Bookmarks', settings: 'Settings', version: 'About Chrome' };

function parse(url: string): { site: Site | null; path: string; host: string } {
  const m = /^(?:https?:\/\/)?([^/]+)(\/.*)?$/i.exec(url.trim());
  const host = (m?.[1] ?? '').toLowerCase();
  return { site: SITES.find((s) => s.host === host) ?? null, path: m?.[2] || '/', host };
}

function titleOf(url: string): string {
  if (url.startsWith('chrome://')) return CHROME_TITLES[url.slice(9).split('/')[0]!] ?? 'Chrome';
  if (url.startsWith('search:')) return `${decodeURIComponent(url.slice(7))} - Search`;
  const { site, host } = parse(url);
  return site ? site.name : host || url;
}

function favicon(url: string): HTMLElement {
  if (url.startsWith('chrome://') || url.startsWith('search:')) return h('span', { class: 'cr-fav chrome' }, appIcon('chrome', 14));
  const { site } = parse(url);
  return h('span', { class: 'cr-fav', style: `background:${site?.color ?? '#9aa0a6'}` }, site ? site.short[0]! : '?');
}

export function chromeWindow(initial?: string, incognito = false): AppDef {
  return {
    id: incognito ? `chrome-incognito:${Date.now()}` : 'browser',
    title: 'Google Chrome',
    icon: 'chrome',
    width: 1200,
    height: 740,
    customTitlebar: true,
    mount(host, win: WinHandle) {
      const data = browserData();
      const blank = (url: string): Tab => ({ url, back: [], fwd: [], pinned: false, zoom: 100 });
      const tabs: Tab[] = [blank(initial ?? win.arg ?? 'chrome://newtab')];
      let active = 0;
      let findText = '';
      let finding = false;
      const strip = h('div', { class: 'cr-tabs', role: 'tablist' });
      const omni = h('input', { class: 'cr-omni', spellcheck: 'false', autocomplete: 'off', placeholder: 'Search the intranet or type a URL', 'aria-label': 'Address and search bar' });
      const star = h('button', { class: 'cr-ib cr-star', type: 'button', title: 'Bookmark this tab (Ctrl+D)', 'aria-label': 'Bookmark this tab' });
      const bar = h('div', { class: 'cr-bookmarks' });
      const view = h('div', { class: 'cr-view' });
      const findBar = h('div', { class: 'cr-find', hidden: true });
      const zoomBadge = h('button', { class: 'cr-ib cr-zoom', type: 'button', hidden: true });
      const tab = (): Tab => tabs[active]!;
      if (incognito) host.classList.add('cr-incognito');

      const navigate = (url: string, push = true): void => {
        const t = tab();
        if (push && t.url !== url) { t.back.push(t.url); t.fwd = []; }
        t.url = url;
        t.title = undefined;
        if (!incognito && url !== 'chrome://newtab') { data.history.unshift({ url, title: titleOf(url), time: new Date().toISOString() }); data.history.splice(500); persist(); }
        draw();
      };
      const back = (): void => { const t = tab(); const p = t.back.pop(); if (p) { t.fwd.push(t.url); navigate(p, false); } };
      const forward = (): void => { const t = tab(); const n = t.fwd.pop(); if (n) { t.back.push(t.url); navigate(n, false); } };
      const newTab = (url = 'chrome://newtab', at = tabs.length): void => {
        tabs.splice(at, 0, blank(url));
        active = at;
        draw();
        if (url === 'chrome://newtab') { omni.focus(); }
      };
      const closeTab = (i: number): void => {
        if (tabs.length === 1) return win.close();
        tabs[i]!.frame?.remove();
        tabs.splice(i, 1);
        if (active >= i) active = Math.max(0, active - 1);
        draw();
      };
      const go = (raw: string): void => {
        let v = raw.trim();
        if (!v) return;
        if (/^chrome:\/\//i.test(v) || /^about:/i.test(v)) return navigate(v.replace(/^about:/i, 'chrome://').toLowerCase());
        if (/^https?:\/\//i.test(v) || /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(v)) { if (!/^https?:\/\//i.test(v)) v = `https://${v}`; return navigate(v); }
        navigate(`search:${encodeURIComponent(v)}`);
      };
      const ctxFor = (site: Site, path: string): SiteCtx => ({ path, go: (p) => navigate(`https://${site.host}${p}`), open: (u) => navigate(u) });
      const bookmarked = (): boolean => data.bookmarks.some((b) => b.url === tab().url);
      const toggleBookmark = (): void => {
        const t = tab();
        if (t.url === 'chrome://newtab') return;
        if (bookmarked()) data.bookmarks = data.bookmarks.filter((b) => b.url !== t.url);
        else data.bookmarks.push({ url: t.url, title: titleOf(t.url) });
        persist();
        toast(bookmarked() ? 'Bookmark added' : 'Bookmark removed');
        draw();
      };
      const toggleBar = (): void => { data.showBar = !data.showBar; persist(); draw(); };
      const clearHistory = (): void => { data.history.length = 0; persist(); toast('Browsing data cleared'); draw(); };
      const setZoom = (z: number): void => { tab().zoom = Math.max(25, Math.min(500, z)); draw(); };
      const anchor = (label: string, url: string): HTMLAnchorElement => h('a', { href: '#', onClick: (e: Event) => { e.preventDefault(); navigate(url); } }, label);

      function chromePage(url: string): HTMLElement {
        const which = url.slice(9).split('/')[0];
        const when = (iso: string): string => new Date(iso).toLocaleString();
        if (which === 'history') {
          return h('div', { class: 'cr-page' }, h('h1', null, 'History'),
            incognito ? h('p', { class: 'muted' }, 'Pages you view in Incognito tabs are not saved in your history.') : null,
            data.history.length
              ? h('div', { class: 'cr-list' }, data.history.slice(0, 200).map((e) => h('div', { class: 'cr-row' }, h('span', { class: 'cr-time' }, when(e.time)), favicon(e.url), anchor(e.title, e.url), h('span', { class: 'cr-url' }, e.url))))
              : h('p', { class: 'muted' }, 'Pages you visit appear here.'),
            data.history.length ? h('button', { class: 'btn', type: 'button', onClick: clearHistory }, 'Clear browsing data') : null);
        }
        if (which === 'downloads') {
          return h('div', { class: 'cr-page' }, h('h1', null, 'Downloads'),
            data.downloads.length
              ? h('div', { class: 'cr-list' }, data.downloads.map((d) => h('div', { class: 'cr-dl' }, appIcon('textFile', 32), h('div', null, h('strong', null, d.name), h('div', { class: 'muted' }, `${(d.size / 1024).toFixed(1)} KB, ${when(d.time)}`)))))
              : h('p', { class: 'muted' }, 'Files you download appear here.'));
        }
        if (which === 'bookmarks') {
          const all = [...SITES.map((s) => ({ url: `https://${s.host}/`, title: s.name })), ...data.bookmarks];
          return h('div', { class: 'cr-page' }, h('h1', null, 'Bookmarks'),
            h('h3', null, 'Bookmarks bar'),
            h('div', { class: 'cr-list' }, all.map((b) => h('div', { class: 'cr-row' }, favicon(b.url), anchor(b.title, b.url), h('span', { class: 'cr-url' }, b.url),
              data.bookmarks.includes(b as BrowserData['bookmarks'][number]) ? h('button', { class: 'cr-ib', type: 'button', title: 'Delete', onClick: () => { data.bookmarks = data.bookmarks.filter((x) => x !== b); persist(); draw(); } }, '') : null))),
            h('h3', null, 'Real portals'),
            h('div', { class: 'cr-list' }, REAL_PORTALS.map(([t, u]) => h('div', { class: 'cr-row' }, h('a', { href: u, target: '_blank', rel: 'noopener noreferrer' }, t), h('span', { class: 'cr-url' }, u)))));
        }
        if (which === 'settings') {
          return h('div', { class: 'cr-page' }, h('h1', null, 'Settings'),
            h('div', { class: 'cr-card' }, h('strong', null, 'Appearance'), h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: data.showBar, onChange: toggleBar }), 'Show bookmarks bar')),
            h('div', { class: 'cr-card' }, h('strong', null, 'Privacy and security'), h('button', { class: 'btn', type: 'button', onClick: clearHistory }, 'Clear browsing data')),
            h('div', { class: 'cr-card' }, h('strong', null, 'On startup'), h('span', { class: 'muted' }, 'Open the New Tab page')),
            h('div', { class: 'cr-card' }, h('strong', null, 'Your browser is managed'), h('span', { class: 'muted' }, `${store.world.company.name} manages this browser through policy.`)));
        }
        if (which === 'version') {
          return h('div', { class: 'cr-page cr-about' }, h('h1', null, 'About Chrome'), appIcon('chrome', 64),
            h('p', null, 'Google Chrome is up to date'), h('p', { class: 'muted' }, 'Version 129.0.6668.90 (Official Build) (64-bit)'),
            h('p', { class: 'muted' }, 'Your browser is managed by your organization.'));
        }
        const q = h('input', { class: 'cr-ntp-search', placeholder: 'Search the intranet or type a URL', 'aria-label': 'Search' });
        q.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(q.value); });
        const tiles = [...SITES.map((s) => ({ url: `https://${s.host}/`, title: s.short, color: s.color })), ...data.bookmarks.slice(0, 3).map((b) => ({ url: b.url, title: b.title, color: '#9aa0a6' }))];
        return h('div', { class: 'cr-ntp' },
          h('div', { class: 'cr-ntp-logo' }, store.world.company.name.split(' ')[0]!),
          h('div', { class: 'cr-ntp-box' }, h('span', { class: 'mdl' }, ''), q),
          h('div', { class: 'cr-ntp-tiles' }, tiles.map((t) =>
            h('button', { class: 'cr-tile', type: 'button', title: t.url, onClick: () => navigate(t.url) }, h('span', { class: 'cr-tile-icon', style: `background:${t.color}` }, t.title[0]!), h('span', { class: 'cr-tile-label' }, t.title)))),
          h('p', { class: 'cr-ntp-note' }, 'Real admin portals open in your own browser from the "Real portals" bookmarks folder. Use them only with a lab tenant you own.'));
      }

      function searchPage(q: string): HTMLElement {
        const text = q.toLowerCase();
        const hits: { title: string; url: string; snippet: string }[] = [];
        for (const s of SITES) if (`${s.name} ${s.host}`.toLowerCase().includes(text)) hits.push({ title: s.name, url: `https://${s.host}/`, snippet: s.host });
        for (const t of store.world.tickets) if (`${t.id} ${t.short}`.toLowerCase().includes(text)) hits.push({ title: `${t.id}: ${t.short}`, url: `https://${serviceDesk.host}/`, snippet: t.state });
        for (const u of store.world.ad.users) if (`${u.sam} ${u.displayName}`.toLowerCase().includes(text)) hits.push({ title: `${u.displayName} (${u.sam})`, url: `https://${peopleHub.host}/`, snippet: `${u.title}, ${u.department}` });
        return h('div', { class: 'cr-page' }, h('p', { class: 'muted' }, `Intranet results for "${q}"`),
          hits.length
            ? hits.slice(0, 30).map((r) => h('div', { class: 'cr-result' }, h('span', { class: 'cr-url' }, r.url), anchor(r.title, r.url), h('p', null, r.snippet)))
            : h('p', null, 'No intranet pages matched.'),
          h('div', { class: 'cr-websearch' }, h('strong', null, 'Search the web'),
            anchor(`Google: ${q}`, `https://www.google.com/search?q=${encodeURIComponent(q)}`),
            anchor(`Bing: ${q}`, `https://www.bing.com/search?q=${encodeURIComponent(q)}`),
            anchor(`DuckDuckGo: ${q}`, `https://duckduckgo.com/?q=${encodeURIComponent(q)}`),
            anchor(`Microsoft Learn: ${q}`, `https://learn.microsoft.com/search/?terms=${encodeURIComponent(q)}`)));
      }

      /**
       * A real website. The installed app shows it in a <webview>, which can
       * load any site. A web browser can only frame sites that allow it, so
       * the web edition says so and offers a real tab.
       */
      function webPage(t: Tab): HTMLElement {
        if (sys().airplane || !navigator.onLine) {
          return h('div', { class: 'cr-err' }, h('div', { class: 'cr-err-icon mdl' }, '\uE871'), h('h1', null, 'No internet'),
            h('p', null, sys().airplane ? 'Airplane mode is on. Turn it off in Quick Settings or Settings > Network & internet.' : 'Check the network cables, modem and router.'),
            h('p', { class: 'muted' }, 'ERR_INTERNET_DISCONNECTED'), h('button', { class: 'btn primary', type: 'button', onClick: () => draw() }, 'Reload'));
        }
        if (t.frame && t.frame.dataset.src === t.url) return t.frame;
        t.frame?.remove();
        let view: HTMLElement;
        if (isDesktop) {
          const wv = document.createElement('webview') as HTMLElement & { getURL?: () => string; reload?: () => void };
          wv.setAttribute('src', t.url);
          wv.setAttribute('partition', incognito ? 'web-incognito' : 'persist:web');
          wv.setAttribute('allowpopups', '');
          wv.className = 'cr-web';
          wv.addEventListener('page-title-updated', (e) => { t.title = (e as unknown as { title: string }).title; drawChrome(); });
          wv.addEventListener('did-navigate', (e) => onWebNavigate(t, (e as unknown as { url: string }).url));
          wv.addEventListener('did-navigate-in-page', (e) => { const ev = e as unknown as { url: string; isMainFrame: boolean }; if (ev.isMainFrame) onWebNavigate(t, ev.url); });
          view = h('div', { class: 'cr-webwrap' }, wv);
        } else {
          const frame = h('iframe', { class: 'cr-web', src: t.url, title: t.url, referrerpolicy: 'no-referrer', sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox' });
          view = h('div', { class: 'cr-webwrap' },
            h('div', { class: 'cr-webnote' }, h('span', { class: 'mdl' }, '\uE946'), h('span', null, 'Many sites refuse to load inside another page. If this stays blank, '), h('a', { href: t.url, target: '_blank', rel: 'noopener noreferrer' }, 'open it in a new browser tab'), h('span', null, ', or install the desktop app, which loads every site.')),
            frame);
        }
        view.dataset.src = t.url;
        t.frame = view;
        return view;
      }

      /** The page navigated itself (a link inside a real site): record it without reloading. */
      function onWebNavigate(t: Tab, url: string): void {
        if (!url || url === t.url) return;
        t.back.push(t.url);
        t.fwd = [];
        t.url = url;
        if (t.frame) t.frame.dataset.src = url;
        if (!incognito) { data.history.unshift({ url, title: t.title ?? titleOf(url), time: new Date().toISOString() }); data.history.splice(500); persist(); }
        drawChrome();
      }

      function page(): HTMLElement {
        const t = tab();
        if (isWeb(t.url)) return webPage(t);
        if (t.url.startsWith('chrome://')) return chromePage(t.url);
        if (t.url.startsWith('search:')) return searchPage(decodeURIComponent(t.url.slice(7)));
        const { site, path, host: hst } = parse(t.url);
        if (!site) {
          const real = /^https?:\/\//i.test(t.url) && !/\.(test|example|invalid)$/i.test(hst);
          return h('div', { class: 'cr-err' }, h('div', { class: 'cr-err-icon mdl' }, ''), h('h1', null, 'This site can’t be reached'),
            h('p', null, 'Check if there is a typo in ', h('strong', null, hst || t.url), '.'),
            h('p', { class: 'muted' }, 'DNS_PROBE_FINISHED_NXDOMAIN'),
            real ? h('p', null, h('a', { href: t.url, target: '_blank', rel: 'noopener noreferrer' }, `Open ${hst} in your own browser`)) : null,
            h('button', { class: 'btn primary', type: 'button', onClick: () => draw() }, 'Reload'));
        }
        return site.render(ctxFor(site, path));
      }

      function kebab(x: number, y: number): void {
        const z = tab().zoom;
        const items: MenuEntry[] = [
          { label: 'New tab', icon: '', shortcut: 'Ctrl+T', onClick: () => newTab() },
          { label: 'New window', icon: '', shortcut: 'Ctrl+N', onClick: () => openApp(chromeWindow(), undefined, false) },
          { label: 'New Incognito window', icon: '', shortcut: 'Ctrl+Shift+N', onClick: () => openApp(chromeWindow('chrome://newtab', true), undefined, false) },
          '-',
          { label: 'History', icon: '', submenu: [{ label: 'History', shortcut: 'Ctrl+H', onClick: () => newTab('chrome://history') }, '-', ...data.history.slice(0, 8).map((e): MenuEntry => ({ label: e.title, onClick: () => navigate(e.url) }))] },
          { label: 'Downloads', icon: '', shortcut: 'Ctrl+J', onClick: () => newTab('chrome://downloads') },
          { label: 'Bookmarks and lists', icon: '', submenu: [
            { label: bookmarked() ? 'Remove bookmark' : 'Bookmark this tab...', shortcut: 'Ctrl+D', onClick: toggleBookmark },
            { label: 'Show bookmarks bar', checked: data.showBar, shortcut: 'Ctrl+Shift+B', onClick: toggleBar },
            { label: 'Bookmark manager', shortcut: 'Ctrl+Shift+O', onClick: () => newTab('chrome://bookmarks') },
          ] },
          '-',
          { label: `Zoom (${z}%)`, icon: '', submenu: [{ label: 'Zoom in', shortcut: 'Ctrl++', onClick: () => setZoom(z + 10) }, { label: 'Zoom out', shortcut: 'Ctrl+-', onClick: () => setZoom(z - 10) }, { label: 'Reset to 100%', shortcut: 'Ctrl+0', onClick: () => setZoom(100) }] },
          '-',
          { label: 'Print...', icon: '', shortcut: 'Ctrl+P', onClick: () => window.print() },
          { label: 'Find and edit', icon: '', submenu: [{ label: 'Find...', shortcut: 'Ctrl+F', onClick: openFind }] },
          { label: 'More tools', icon: '', submenu: [{ label: 'Clear browsing data...', shortcut: 'Ctrl+Shift+Del', onClick: clearHistory }, { label: 'Developer tools', shortcut: 'Ctrl+Shift+I', disabled: true }] },
          '-',
          { label: 'Help', icon: '', submenu: [{ label: 'About Google Chrome', onClick: () => newTab('chrome://version') }] },
          { label: 'Settings', icon: '', onClick: () => newTab('chrome://settings') },
          { label: 'Exit', icon: '', onClick: () => win.close() },
        ];
        showMenu(x, y, items);
      }

      function openFind(): void {
        finding = true;
        drawFind();
        (findBar.querySelector('input') as HTMLInputElement | null)?.focus();
      }
      function drawFind(): void {
        findBar.hidden = !finding;
        clear(findBar);
        if (!finding) return;
        const input = h('input', { value: findText, 'aria-label': 'Find in page' });
        const count = h('span', { class: 'muted cr-find-count' });
        const close = (): void => { finding = false; drawFind(); };
        const run = (forward: boolean): void => {
          findText = input.value;
          const total = findText ? (view.textContent ?? '').toLowerCase().split(findText.toLowerCase()).length - 1 : 0;
          count.textContent = findText ? `${total} result${total === 1 ? '' : 's'}` : '';
          const finder = (window as unknown as { find?: (t: string, c: boolean, b: boolean, w: boolean) => boolean }).find;
          if (findText && total) { finder?.(findText, false, !forward, true); input.focus(); }
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(!e.shiftKey); if (e.key === 'Escape') close(); });
        input.addEventListener('input', () => run(true));
        findBar.append(input, count,
          h('button', { type: 'button', class: 'cr-ib', title: 'Previous (Shift+Enter)', onClick: () => run(false) }, ''),
          h('button', { type: 'button', class: 'cr-ib', title: 'Next (Enter)', onClick: () => run(true) }, ''),
          h('button', { type: 'button', class: 'cr-ib', title: 'Close (Esc)', onClick: close }, ''));
      }

      function tabMenu(e: MouseEvent, i: number): void {
        e.preventDefault();
        e.stopPropagation();
        const x = tabs[i]!;
        showMenu(e.clientX, e.clientY, [
          { label: 'New tab to the right', onClick: () => newTab('chrome://newtab', i + 1) },
          '-',
          { label: 'Reload', shortcut: 'Ctrl+R', onClick: () => { active = i; draw(); } },
          { label: 'Duplicate', onClick: () => { tabs.splice(i + 1, 0, { ...x, back: [...x.back], fwd: [] }); active = i + 1; draw(); } },
          { label: x.pinned ? 'Unpin' : 'Pin', onClick: () => { x.pinned = !x.pinned; tabs.sort((a, b) => Number(b.pinned) - Number(a.pinned)); active = tabs.indexOf(x); draw(); } },
          '-',
          { label: 'Close', shortcut: 'Ctrl+W', onClick: () => closeTab(i) },
          { label: 'Close other tabs', disabled: tabs.length === 1, onClick: () => { tabs.splice(0, tabs.length, x); active = 0; draw(); } },
          { label: 'Close tabs to the right', disabled: i === tabs.length - 1, onClick: () => { tabs.splice(i + 1); active = Math.min(active, i); draw(); } },
        ]);
      }

      function draw(): void {
        drawChrome();
        drawPage();
      }

      /** Tabs, omnibox, bookmarks bar and title: everything except the page. */
      function drawChrome(): void {
        const t = tab();
        if (document.activeElement !== omni) omni.value = t.url === 'chrome://newtab' ? '' : t.url.startsWith('search:') ? decodeURIComponent(t.url.slice(7)) : t.url;
        star.textContent = bookmarked() ? '' : '';
        star.classList.toggle('on', bookmarked());
        win.setTitle(`${t.title && isWeb(t.url) ? t.title : titleOf(t.url)} - Google Chrome${incognito ? ' (Incognito)' : ''}`);
        clear(strip);
        tabs.forEach((x, i) => {
          strip.appendChild(h('div', {
            class: `cr-tab${i === active ? ' on' : ''}${x.pinned ? ' pinned' : ''}`, role: 'tab', 'aria-selected': String(i === active), title: titleOf(x.url),
            onMousedown: (e: MouseEvent) => { if (e.button === 1) { e.preventDefault(); closeTab(i); } else if (e.button === 0 && i !== active) { active = i; draw(); } },
            onContextmenu: (e: MouseEvent) => tabMenu(e, i),
          },
          favicon(x.url),
          x.pinned ? null : h('span', { class: 'cr-tab-title' }, x.title && isWeb(x.url) ? x.title : titleOf(x.url)),
          x.pinned ? null : h('button', { class: 'cr-tab-x', type: 'button', 'aria-label': 'Close tab', onMousedown: (e: MouseEvent) => e.stopPropagation(), onClick: (e: Event) => { e.stopPropagation(); closeTab(i); } }, '')));
        });
        strip.appendChild(h('button', { class: 'cr-newtab', type: 'button', title: 'New tab (Ctrl+T)', 'aria-label': 'New tab', onClick: () => newTab() }, ''));
        clear(bar);
        bar.hidden = !data.showBar;
        for (const s of SITES) {
          const url = `https://${s.host}/`;
          bar.appendChild(h('button', { class: 'cr-bm', type: 'button', title: s.name, onClick: () => navigate(url), onAuxclick: (e: MouseEvent) => { if (e.button === 1) newTab(url, active + 1); } }, favicon(url), s.short));
        }
        for (const b of data.bookmarks) bar.appendChild(h('button', { class: 'cr-bm', type: 'button', title: b.title, onClick: () => navigate(b.url) }, favicon(b.url), b.title.slice(0, 24)));
        bar.appendChild(h('button', { class: 'cr-bm folder', type: 'button', onClick: (e: MouseEvent) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          showMenu(r.left, r.bottom + 2, REAL_PORTALS.map(([label, href]): MenuEntry => ({ label, icon: '', onClick: () => newTab(href, active + 1) })));
        } }, h('span', { class: 'mdl' }, ''), 'Real portals'));
        zoomBadge.hidden = t.zoom === 100;
        zoomBadge.textContent = t.zoom > 100 ? '' : '';
        zoomBadge.title = `Zoom: ${t.zoom}% (click to reset)`;
      }

      /**
       * The page. Real websites keep their live view for the life of the tab
       * (hidden when another tab is showing): detaching a webview reloads it.
       */
      function drawPage(): void {
        const t = tab();
        const scroller = view.querySelector('.site-content, .cr-page');
        const keep = scroller ? scroller.scrollTop : 0;
        const prevUrl = view.dataset.url;
        for (const el of [...view.children]) if (!(el as HTMLElement).classList.contains('cr-webwrap')) el.remove();
        const content = page();
        content.style.zoom = String(t.zoom / 100);
        for (const el of view.querySelectorAll<HTMLElement>(':scope > .cr-webwrap')) el.hidden = el !== content;
        if (content.parentElement !== view) view.appendChild(content);
        view.dataset.url = t.url;
        const next = view.querySelector('.site-content, .cr-page');
        if (next && prevUrl === t.url) next.scrollTop = keep;
        drawFind();
      }

      // Select the address on the first click, as Chrome does, without eating what is typed next.
      let selectOnUp = false;
      omni.addEventListener('mousedown', () => { selectOnUp = document.activeElement !== omni; });
      omni.addEventListener('mouseup', (e) => { if (selectOnUp && omni.selectionStart === omni.selectionEnd) { e.preventDefault(); omni.select(); } selectOnUp = false; });
      omni.addEventListener('focus', () => omni.select());
      omni.addEventListener('blur', () => draw());
      omni.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { const v = omni.value; omni.blur(); go(v); }
        if (e.key === 'Escape') omni.blur();
      });
      star.addEventListener('click', toggleBookmark);
      zoomBadge.addEventListener('click', () => setZoom(100));
      const ib = (glyph: string, title: string, fn: () => void): HTMLButtonElement => h('button', { class: 'cr-ib', type: 'button', title, 'aria-label': title, onClick: fn }, glyph);
      const menuAt = (fn: (r: DOMRect) => void) => (e: MouseEvent): void => fn((e.currentTarget as HTMLElement).getBoundingClientRect());
      const profile = h('button', { class: 'cr-profile', type: 'button', title: incognito ? 'Incognito' : store.world.player.displayName,
        onClick: menuAt((r) => showMenu(r.right - 240, r.bottom + 2, [
          { label: incognito ? 'Incognito' : store.world.player.displayName, bold: true, disabled: true },
          { label: `${store.world.player.sam}@${store.world.ad.domain}`, disabled: true },
          '-',
          { label: `Managed by ${store.world.company.name}`, icon: '', disabled: true },
        ])) }, incognito ? h('span', { class: 'mdl' }, '') : h('span', { class: 'cr-avatar' }, store.world.player.displayName.split(' ').map((p) => p[0]).join('').slice(0, 2)));
      const toolbar = h('div', { class: 'cr-toolbar' },
        ib('', 'Click to go back', back),
        ib('', 'Click to go forward', forward),
        ib('', 'Reload this page', () => draw()),
        ib('', 'Open the home page', () => navigate('chrome://newtab')),
        h('div', { class: 'cr-omnibox' }, h('span', { class: 'mdl cr-lock', title: 'Connection is secure' }, ''), omni, zoomBadge, star),
        profile,
        h('button', { class: 'cr-ib cr-kebab', type: 'button', title: 'Customize and control Google Chrome', 'aria-label': 'Customize and control Google Chrome', onClick: menuAt((r) => kebab(r.right - 280, r.bottom + 2)) }, ''));
      win.titleSlot?.appendChild(strip);
      win.titleSlot?.closest('.win')?.classList.add('chrome', ...(incognito ? ['incognito'] : []));
      host.appendChild(h('div', { class: 'cr' }, toolbar, bar, findBar, view));

      view.addEventListener('contextmenu', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('input, textarea, select')) return;
        e.preventDefault();
        const sel = window.getSelection()?.toString() ?? '';
        const a = target.closest('a');
        if (a && a.getAttribute('href') && a.getAttribute('href') !== '#') {
          showMenu(e.clientX, e.clientY, [{ label: 'Open link in new window', onClick: () => window.open(a.href, '_blank', 'noopener,noreferrer') }, { label: 'Copy link address', onClick: () => void navigator.clipboard?.writeText(a.href).catch(() => undefined) }]);
          return;
        }
        const t = tab();
        showMenu(e.clientX, e.clientY, [
          ...(sel ? [{ label: 'Copy', shortcut: 'Ctrl+C', onClick: () => void navigator.clipboard?.writeText(sel).catch(() => undefined) }, { label: `Search for "${sel.slice(0, 20)}"`, onClick: () => newTab(`search:${encodeURIComponent(sel)}`, active + 1) }, '-' as const] : []),
          { label: 'Back', shortcut: 'Alt+Left Arrow', disabled: !t.back.length, onClick: back },
          { label: 'Forward', shortcut: 'Alt+Right Arrow', disabled: !t.fwd.length, onClick: forward },
          { label: 'Reload', shortcut: 'Ctrl+R', onClick: () => draw() },
          '-',
          { label: 'Bookmark this tab...', shortcut: 'Ctrl+D', onClick: toggleBookmark },
          { label: 'Print...', shortcut: 'Ctrl+P', onClick: () => window.print() },
          '-',
          { label: 'View page source', shortcut: 'Ctrl+U', disabled: true },
          { label: 'Inspect', disabled: true },
        ]);
      });

      const winEl = win.titleSlot?.closest('.win') as HTMLElement | null;
      // Shortcuts work whenever this window is the active one, as in Chrome.
      const onKey = (e: KeyboardEvent): void => {
        if (!winEl?.classList.contains('active') || !winEl.isConnected) return;
        if (document.querySelector('.cm, .mm-shield, .copilot:not([hidden]):focus-within')) return;
        const k = (e.key ?? "").toLowerCase();
        const ctrl = e.ctrlKey || e.metaKey;
        let handled = true;
        if (ctrl && e.shiftKey && k === 'n') openApp(chromeWindow('chrome://newtab', true), undefined, false);
        else if (ctrl && e.shiftKey && k === 'b') toggleBar();
        else if (ctrl && e.shiftKey && k === 'o') newTab('chrome://bookmarks');
        else if (ctrl && e.shiftKey && k === 't') newTab();
        else if (ctrl && k === 'tab') { active = (active + (e.shiftKey ? tabs.length - 1 : 1)) % tabs.length; draw(); }
        else if (ctrl && /^[1-8]$/.test(k)) { active = Math.min(tabs.length - 1, Number(k) - 1); draw(); }
        else if (ctrl && k === '9') { active = tabs.length - 1; draw(); }
        else if (ctrl && k === 't') newTab();
        else if (ctrl && k === 'n') openApp(chromeWindow(), undefined, false);
        else if (ctrl && k === 'w') closeTab(active);
        else if ((ctrl && k === 'l') || (e.altKey && k === 'd') || e.key === 'F6') { omni.focus(); omni.select(); }
        else if ((ctrl && k === 'r') || e.key === 'F5') draw();
        else if (ctrl && k === 'd') toggleBookmark();
        else if (ctrl && k === 'h') newTab('chrome://history');
        else if (ctrl && k === 'j') newTab('chrome://downloads');
        else if ((ctrl && k === 'f') || e.key === 'F3') openFind();
        else if (ctrl && (k === '=' || k === '+')) setZoom(tab().zoom + 10);
        else if (ctrl && k === '-') setZoom(tab().zoom - 10);
        else if (ctrl && k === '0') setZoom(100);
        else if (e.altKey && e.key === 'ArrowLeft') back();
        else if (e.altKey && e.key === 'ArrowRight') forward();
        else if (e.altKey && e.key === 'Home') navigate('chrome://newtab');
        else handled = false;
        if (handled) { e.preventDefault(); e.stopPropagation(); }
      };
      document.addEventListener('keydown', onKey);
      onOpenArg(win, (url) => { if (url) newTab(url); });
      draw();
      return { redraw: draw, dispose: () => document.removeEventListener('keydown', onKey) };
    },
  };
}

export const browserApp: AppDef = chromeWindow();
