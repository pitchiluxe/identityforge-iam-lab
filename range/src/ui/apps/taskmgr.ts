/**
 * Task Manager, as on Windows 11 (Ctrl+Shift+Esc, or right-click the taskbar):
 * Processes, Performance, Startup apps, Users, Details, Services and Settings.
 *
 * Apps are the windows open on this desktop: End task closes the window, Switch
 * to brings it forward, Run new task starts a program. Startup apps changes the
 * same list as Settings > Apps > Startup. The rest of the machine comes from
 * core/taskmgr.ts. Text is set with textContent only.
 */
import { type Proc, type ProcGroup, SERVICES, processes, sortProcs, totals, INSTALLED_MB } from '../../core/taskmgr.ts';
import { button, clear, h, toast } from '../dom.ts';
import { appIcon } from '../icons.ts';
import { persist, store } from '../store.ts';
import { ai } from '../aiState.ts';
import { STARTUP_APPS, setSys, sys } from '../system.ts';
import { showMenu } from '../ctxmenu.ts';
import { type AppDef, closeWindow, focusWindow, windowList } from '../wm.ts';

type Page = 'processes' | 'performance' | 'startup' | 'users' | 'details' | 'services' | 'settings';
type SortKey = 'name' | 'cpu' | 'memMb' | 'diskMbs' | 'netMbps' | 'pid';
type Speed = 'high' | 'normal' | 'low' | 'paused';

const NAV: [Page, string, string][] = [
  ['processes', 'Processes', ''], ['performance', 'Performance', ''], ['startup', 'Startup apps', ''],
  ['users', 'Users', ''], ['details', 'Details', ''], ['services', 'Services', ''],
];
const SPEED_MS: Record<Speed, number> = { high: 500, normal: 1000, low: 4000, paused: 0 };
const HISTORY = 60;

let runHook: () => void = () => {};
/** Run new task opens the Run dialog the shell owns. */
export function setRunNewTask(fn: () => void): void {
  runHook = fn;
}

const NS = 'http://www.w3.org/2000/svg';
function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** A Task Manager graph: grid, filled area and line, newest sample on the right. */
function graph(values: number[], max: number, cls: string, big: boolean): SVGSVGElement {
  const w = 300, hgt = 100;
  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${hgt}`, preserveAspectRatio: 'none', class: `tm-graph ${cls} ${big ? 'big' : ''}`, 'aria-hidden': 'true' });
  if (big) for (let i = 1; i < 10; i++) svg.appendChild(svgEl('line', { x1: String((w / 10) * i), y1: '0', x2: String((w / 10) * i), y2: String(hgt), class: 'tm-gridline' }));
  if (big) for (let i = 1; i < 10; i++) svg.appendChild(svgEl('line', { x1: '0', y1: String((hgt / 10) * i), x2: String(w), y2: String((hgt / 10) * i), class: 'tm-gridline' }));
  const pad = Array(Math.max(0, HISTORY - values.length)).fill(0).concat(values.slice(-HISTORY)) as number[];
  const pts = pad.map((v, i) => `${(i / (HISTORY - 1)) * w},${hgt - Math.min(1, v / (max || 1)) * hgt}`);
  svg.appendChild(svgEl('polygon', { points: `0,${hgt} ${pts.join(' ')} ${w},${hgt}`, class: 'tm-area' }));
  svg.appendChild(svgEl('polyline', { points: pts.join(' '), class: 'tm-line', fill: 'none' }));
  return svg;
}

const fmtMb = (mb: number): string => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`);
const pct = (n: number): string => `${n.toFixed(n < 10 && n > 0 ? 1 : 0)}%`;

export const taskManagerApp: AppDef = {
  id: 'taskmgr',
  title: 'Task Manager',
  icon: 'taskmgr',
  width: 1000,
  height: 660,
  mount(host) {
    const prefs = (): NonNullable<typeof store.settings.taskManager> => store.settings.taskManager ?? {};
    let page: Page = (prefs().startPage as Page) || 'processes';
    let navOpen = true;
    let query = '';
    let selected: number | null = null;
    let sort: { key: SortKey; desc: boolean } = { key: 'name', desc: false };
    let perfView: 'cpu' | 'memory' | 'disk' | 'ethernet' = 'cpu';
    const collapsed = new Set<ProcGroup>();
    let userOpen = true;
    const efficiency = new Set<number>();
    let tick = 0;
    let procs: Proc[] = [];
    const hist = { cpu: [] as number[], mem: [] as number[], disk: [] as number[], net: [] as number[] };
    const started = Date.now();

    const sample = (): void => {
      tick++;
      const online = navigator.onLine && !sys().airplane;
      procs = processes({ windows: windowList(), aiOnline: ai.status === 'online', online, tick, user: `${store.world.ad.netbios}\\${store.world.player.sam}`, efficiency });
      for (const pid of [...efficiency]) if (!procs.some((p) => p.pid === pid)) efficiency.delete(pid);
      const t = totals(procs);
      for (const [k, v] of [['cpu', t.cpu], ['mem', t.memPct], ['disk', Math.min(100, t.diskMbs * 8)], ['net', t.netMbps]] as const) {
        hist[k].push(v);
        if (hist[k].length > HISTORY) hist[k].shift();
      }
    };

    const endTask = (p: Proc): void => {
      if (p.winId) { closeWindow(p.winId); selected = null; sample(); draw(); return; }
      if (p.exe === 'explorer.exe') { toast('Windows Explorer restarted', 'ok'); return; }
      toast(p.critical ? `Unable to terminate process: ${p.name}. Access is denied.` : `${p.name} is a background process this lab keeps running. End the app windows instead.`, 'err');
    };
    const toggleEfficiency = (p: Proc): void => {
      if (p.critical) return void toast(`Efficiency mode is not available for ${p.name}: it is a core Windows process.`, 'err');
      if (efficiency.has(p.pid)) efficiency.delete(p.pid); else efficiency.add(p.pid);
      sample();
      draw();
    };
    const procMenu = (e: MouseEvent, p: Proc): void => {
      e.preventDefault();
      selected = p.pid;
      showMenu(e.clientX, e.clientY, [
        ...(p.winId ? [{ label: 'Switch to', onClick: () => focusWindow(p.winId!) }] : []),
        { label: p.exe === 'explorer.exe' ? 'Restart' : 'End task', onClick: () => endTask(p) },
        { label: 'Efficiency mode', checked: efficiency.has(p.pid), onClick: () => toggleEfficiency(p) },
        '-',
        { label: 'Go to details', onClick: () => { page = 'details'; draw(); } },
        { label: 'Search online', onClick: () => window.open(`https://www.bing.com/search?q=${encodeURIComponent(p.exe)}`, '_blank', 'noopener,noreferrer') },
      ]);
      draw();
    };

    function toolbar(title: string, ...actions: (HTMLElement | null)[]): HTMLElement {
      const search = h('input', { class: 'tm-search', type: 'search', placeholder: 'Type a name, publisher, or PID to search', value: query, 'aria-label': 'Search processes',
        onInput: (e: Event) => { query = (e.target as HTMLInputElement).value; draw(); const el = host.querySelector('.tm-search') as HTMLInputElement | null; el?.focus(); el?.setSelectionRange(query.length, query.length); } });
      return h('div', { class: 'tm-top' }, h('h1', null, title), h('div', { class: 'tm-actions' }, ...actions), page === 'processes' || page === 'details' ? search : null);
    }

    const sel = (): Proc | undefined => procs.find((p) => p.pid === selected);
    const runBtn = (): HTMLElement => h('button', { class: 'tm-act', type: 'button', onClick: () => runHook() }, h('span', { class: 'mdl' }, ''), 'Run new task');
    const endBtn = (): HTMLElement => h('button', { class: 'tm-act', type: 'button', disabled: !sel(), onClick: () => { const p = sel(); if (p) endTask(p); } }, h('span', { class: 'mdl' }, ''), sel()?.exe === 'explorer.exe' ? 'Restart' : 'End task');
    const effBtn = (): HTMLElement => h('button', { class: 'tm-act', type: 'button', disabled: !sel(), 'aria-pressed': String(!!selected && efficiency.has(selected)), onClick: () => { const p = sel(); if (p) toggleEfficiency(p); } }, h('span', { class: 'mdl' }, ''), 'Efficiency mode');

    const matches = (p: Proc): boolean => {
      const q = query.trim().toLowerCase();
      return !q || p.name.toLowerCase().includes(q) || p.exe.toLowerCase().includes(q) || p.publisher.toLowerCase().includes(q) || String(p.pid) === q;
    };
    const header = (cols: [SortKey | null, string, string][]): HTMLElement => h('tr', null, cols.map(([k, label, cls]) => h('th', { class: `${cls} ${k && sort.key === k ? 'sorted' : ''}`, onClick: k ? () => { sort = { key: k, desc: sort.key === k ? !sort.desc : k !== 'name' && k !== 'pid' }; draw(); } : undefined }, label, k && sort.key === k ? h('span', { class: 'mdl tm-caret' }, sort.desc ? '' : '') : null)));

    function processesPage(): HTMLElement {
      const t = totals(procs);
      const heat = (v: number, max: number): string => `--heat:${Math.min(1, v / max).toFixed(2)}`;
      const row = (p: Proc): HTMLElement => h('tr', { class: `tm-row ${selected === p.pid ? 'on' : ''}`, tabIndex: 0, onClick: () => { selected = p.pid; draw(); }, onDblclick: () => { if (p.winId) focusWindow(p.winId); }, onContextmenu: (e: MouseEvent) => procMenu(e, p),
        onKeydown: (e: KeyboardEvent) => { if (e.key === 'Delete') endTask(p); } },
        h('td', { class: 'tm-name' }, p.winId ? appIcon(windowList().find((w) => w.id === p.winId)?.icon ?? 'programs', 16) : h('span', { class: 'mdl tm-pi' }, p.group === 'windows' ? '' : ''), h('span', null, p.name)),
        h('td', { class: 'tm-status' }, p.status === 'Efficiency mode' ? h('span', { class: 'mdl tm-leaf', title: 'Efficiency mode' }, '') : null),
        h('td', { class: 'num heat', style: heat(p.cpu, 10) }, pct(p.cpu)),
        h('td', { class: 'num heat', style: heat(p.memMb, 600) }, fmtMb(p.memMb)),
        h('td', { class: 'num heat', style: heat(p.diskMbs, 2) }, `${p.diskMbs.toFixed(1)} MB/s`),
        h('td', { class: 'num heat', style: heat(p.netMbps, 2) }, `${p.netMbps.toFixed(1)} Mbps`));
      const group = (g: ProcGroup, label: string): HTMLElement[] => {
        const list = sortProcs(procs.filter((p) => p.group === g && matches(p)), sort.key, sort.desc);
        if (!list.length) return [];
        const open = !collapsed.has(g);
        return [h('tr', { class: 'tm-group', onClick: () => { if (open) collapsed.add(g); else collapsed.delete(g); draw(); } }, h('td', { colspan: '6' }, h('span', { class: 'mdl' }, open ? '' : ''), `${label} (${list.length})`)), ...(open ? list.map(row) : [])];
      };
      return h('div', { class: 'tm-page' },
        toolbar('Processes', runBtn(), endBtn(), effBtn()),
        h('div', { class: 'tm-scroll' }, h('table', { class: 'tm-table' },
          h('thead', null, header([['name', 'Name', ''], [null, 'Status', 'tm-status'], ['cpu', `${pct(t.cpu)}\nCPU`, 'num'], ['memMb', `${t.memPct}%\nMemory`, 'num'], ['diskMbs', `${Math.min(100, Math.round(t.diskMbs * 8))}%\nDisk`, 'num'], ['netMbps', `${Math.round(t.netMbps * 10)}%\nNetwork`, 'num']])),
          h('tbody', null, ...group('app', 'Apps'), ...group('background', 'Background processes'), ...group('windows', 'Windows processes')))));
    }

    function performancePage(): HTMLElement {
      const t = totals(procs);
      const online = navigator.onLine && !sys().airplane;
      const up = Math.floor((Date.now() - started) / 1000) + 3 * 86400 + 4 * 3600;
      const upText = `${Math.floor(up / 86400)}:${String(Math.floor((up % 86400) / 3600)).padStart(2, '0')}:${String(Math.floor((up % 3600) / 60)).padStart(2, '0')}:${String(up % 60).padStart(2, '0')}`;
      const tiles: ['cpu' | 'memory' | 'disk' | 'ethernet', string, string, number[], number, string][] = [
        ['cpu', 'CPU', `${pct(t.cpu)}  2.70 GHz`, hist.cpu, 100, 'c-cpu'],
        ['memory', 'Memory', `${fmtMb(t.memMb)}/${fmtMb(INSTALLED_MB)} (${t.memPct}%)`, hist.mem, 100, 'c-mem'],
        ['disk', 'Disk 0 (C:)', `SSD\n${Math.min(100, Math.round(t.diskMbs * 8))}%`, hist.disk, 100, 'c-disk'],
        ['ethernet', 'Ethernet', online ? `Ethernet\nS: 0.1  R: ${(t.netMbps * 1000).toFixed(0)} Kbps` : 'Not connected', hist.net, 5, 'c-net'],
      ];
      const cur = tiles.find((x) => x[0] === perfView)!;
      const kv = (pairs: [string, string][]): HTMLElement => h('div', { class: 'tm-kv' }, pairs.map(([k, v]) => h('div', null, h('span', null, k), h('strong', null, v))));
      const details: Record<typeof perfView, HTMLElement> = {
        cpu: kv([['Utilization', pct(t.cpu)], ['Speed', '2.70 GHz'], ['Processes', String(t.count)], ['Threads', String(t.threads)], ['Handles', String(t.handles)], ['Up time', upText], ['Base speed', '2.70 GHz'], ['Sockets', '1'], ['Cores', '10'], ['Logical processors', '12'], ['Virtualization', 'Enabled'], ['L3 cache', '12.0 MB']]),
        memory: kv([['In use', fmtMb(t.memMb)], ['Available', fmtMb(INSTALLED_MB - t.memMb)], ['Committed', `${fmtMb(t.memMb * 1.3)}/${fmtMb(INSTALLED_MB * 1.4)}`], ['Cached', fmtMb(INSTALLED_MB * 0.28)], ['Speed', '4800 MT/s'], ['Slots used', '2 of 2'], ['Form factor', 'SODIMM'], ['Hardware reserved', '241 MB']]),
        disk: kv([['Active time', `${Math.min(100, Math.round(t.diskMbs * 8))}%`], ['Average response time', '0.4 ms'], ['Read speed', `${(t.diskMbs * 0.7).toFixed(1)} MB/s`], ['Write speed', `${(t.diskMbs * 0.3).toFixed(1)} MB/s`], ['Capacity', '477 GB'], ['Formatted', '476 GB'], ['System disk', 'Yes'], ['Type', 'SSD (NVMe)']]),
        ethernet: kv([['Send', online ? '0.1 Kbps' : '0 Kbps'], ['Receive', `${(t.netMbps * 1000).toFixed(0)} Kbps`], ['Adapter name', 'Ethernet'], ['DNS name', store.world.ad.domain], ['Connection type', 'Ethernet'], ['IPv4 address', '10.10.20.15'], ['IPv6 address', 'fe80::1c4f:9a2e:6b11:3d07%12'], ['Status', online ? 'Connected' : (sys().airplane ? 'Disconnected (Airplane mode)' : 'Disconnected')]]),
      };
      return h('div', { class: 'tm-page' }, toolbar('Performance', runBtn()),
        h('div', { class: 'tm-perf' },
          h('div', { class: 'tm-tiles' }, tiles.map(([id, name, sub, data, max, cls]) => h('button', { class: `tm-tile ${perfView === id ? 'on' : ''}`, type: 'button', onClick: () => { perfView = id; draw(); } },
            graph(data, max, cls, false), h('span', { class: 'tm-tile-text' }, h('strong', null, name), h('span', null, sub))))),
          h('div', { class: 'tm-detail' },
            h('div', { class: 'tm-dhead' }, h('h2', null, cur[1]), h('span', null, perfView === 'cpu' ? '12th Gen Intel(R) Core(TM) i7-1265U' : perfView === 'memory' ? '16.0 GB' : perfView === 'disk' ? 'SAMSUNG MZVL2512HCJQ' : 'Intel(R) Ethernet Connection (16) I219-LM')),
            h('div', { class: 'tm-gcap' }, h('span', null, perfView === 'cpu' ? '% Utilization over 60 seconds' : perfView === 'memory' ? 'Memory usage' : perfView === 'disk' ? 'Active time' : 'Throughput'), h('span', null, perfView === 'ethernet' ? '5 Mbps' : '100%')),
            graph(cur[3], cur[4], cur[5], true),
            details[perfView])));
    }

    function startupPage(): HTMLElement {
      const y = sys();
      const impact: Record<string, string> = { coach: 'Medium', notes: 'Low', browser: 'High', copilot: 'Medium', terminal: 'Low' };
      const publisher: Record<string, string> = { coach: 'Meridian Health System', notes: 'Microsoft Corporation', browser: 'Google LLC', copilot: 'Meridian Health System', terminal: 'Microsoft Corporation' };
      let pick = (host.dataset.startupPick ?? '') as string;
      const enabled = (id: string): boolean => y.startupApps.includes(id);
      const flip = (id: string): void => { setSys({ startupApps: enabled(id) ? y.startupApps.filter((x) => x !== id) : [...y.startupApps, id] }); draw(); };
      return h('div', { class: 'tm-page' },
        toolbar('Startup apps', runBtn(), pick ? button(enabled(pick) ? 'Disable' : 'Enable', () => flip(pick), 'tm-act') : null),
        h('p', { class: 'tm-note' }, 'Apps that open when you sign in. The same list as Settings > Apps > Startup.'),
        h('div', { class: 'tm-scroll' }, h('table', { class: 'tm-table' },
          h('thead', null, h('tr', null, ['Name', 'Publisher', 'Status', 'Startup impact'].map((c) => h('th', null, c)))),
          h('tbody', null, STARTUP_APPS.map(([id, label]) => h('tr', { class: `tm-row ${pick === id ? 'on' : ''}`, tabIndex: 0, onClick: () => { pick = id; host.dataset.startupPick = id; draw(); },
            onContextmenu: (e: MouseEvent) => { e.preventDefault(); showMenu(e.clientX, e.clientY, [{ label: enabled(id) ? 'Disable' : 'Enable', onClick: () => flip(id) }]); } },
            h('td', null, label), h('td', null, publisher[id] ?? ''), h('td', null, enabled(id) ? 'Enabled' : 'Disabled'), h('td', null, enabled(id) ? impact[id] ?? 'Low' : 'Not measured')))))));
    }

    function usersPage(): HTMLElement {
      const t = totals(procs);
      const mine = procs.filter((p) => p.user.endsWith(`\\${store.world.player.sam}`));
      const cpu = mine.reduce((n, p) => n + p.cpu, 0), mem = mine.reduce((n, p) => n + p.memMb, 0);
      const open = userOpen;
      return h('div', { class: 'tm-page' }, toolbar('Users', runBtn()),
        h('div', { class: 'tm-scroll' }, h('table', { class: 'tm-table' },
          h('thead', null, h('tr', null, h('th', null, 'User'), h('th', null, 'Status'), h('th', { class: 'num' }, `${pct(t.cpu)}\nCPU`), h('th', { class: 'num' }, `${t.memPct}%\nMemory`))),
          h('tbody', null,
            h('tr', { class: 'tm-group', onClick: () => { userOpen = !userOpen; draw(); } },
              h('td', null, h('span', { class: 'mdl' }, open ? '' : ''), `${store.world.player.displayName} (${mine.length})`), h('td', null, 'Active'), h('td', { class: 'num' }, pct(cpu)), h('td', { class: 'num' }, fmtMb(mem))),
            ...(open ? mine.map((p) => h('tr', { class: 'tm-row', onContextmenu: (e: MouseEvent) => procMenu(e, p) }, h('td', { class: 'tm-name sub' }, h('span', null, p.name)), h('td', null, ''), h('td', { class: 'num' }, pct(p.cpu)), h('td', { class: 'num' }, fmtMb(p.memMb)))) : [])))),
        h('p', { class: 'tm-note' }, `Signed in as ${store.world.ad.netbios}\\${store.world.player.sam} at the console. Other people sign in on their own workstations.`));
    }

    function detailsPage(): HTMLElement {
      const list = sortProcs(procs.filter(matches), sort.key === 'diskMbs' || sort.key === 'netMbps' ? 'name' : sort.key, sort.desc);
      return h('div', { class: 'tm-page' }, toolbar('Details', runBtn(), endBtn(), effBtn()),
        h('div', { class: 'tm-scroll' }, h('table', { class: 'tm-table dense' },
          h('thead', null, header([['name', 'Name', ''], ['pid', 'PID', 'num'], [null, 'Status', ''], [null, 'User name', ''], ['cpu', 'CPU', 'num'], ['memMb', 'Memory (active private working set)', 'num'], [null, 'Architecture', ''], [null, 'Description', '']])),
          h('tbody', null, list.map((p) => h('tr', { class: `tm-row ${selected === p.pid ? 'on' : ''}`, tabIndex: 0, onClick: () => { selected = p.pid; draw(); }, onContextmenu: (e: MouseEvent) => procMenu(e, p) },
            h('td', null, p.exe), h('td', { class: 'num' }, String(p.pid)), h('td', null, p.status), h('td', null, p.user), h('td', { class: 'num' }, String(Math.round(p.cpu)).padStart(2, '0')),
            h('td', { class: 'num' }, `${Math.round(p.memMb * 1024).toLocaleString()} K`), h('td', null, 'x64'), h('td', null, p.description)))))));
    }

    function servicesPage(): HTMLElement {
      return h('div', { class: 'tm-page' }, toolbar('Services', runBtn()),
        h('div', { class: 'tm-scroll' }, h('table', { class: 'tm-table dense' },
          h('thead', null, h('tr', null, ['Name', 'PID', 'Description', 'Status', 'Group'].map((c) => h('th', null, c)))),
          h('tbody', null, SERVICES.map((s) => h('tr', { class: 'tm-row', title: s.description }, h('td', null, s.name), h('td', { class: 'num' }, s.pid ? String(s.pid) : ''), h('td', null, s.display), h('td', null, s.status), h('td', null, s.group)))))),
        h('p', { class: 'tm-note' }, 'Netlogon keeps the secure channel to the domain controller; Windows Time keeps the clock within the 5 minutes Kerberos allows. Hover a service for what it does.'));
    }

    function settingsPage(): HTMLElement {
      const p = prefs();
      const save = (patch: Partial<typeof p>): void => { store.settings.taskManager = { ...p, ...patch }; persist(); restartTimer(); draw(); };
      const selectEl = (value: string, options: [string, string][], onChange: (v: string) => void, label: string): HTMLSelectElement =>
        h('select', { class: 'input', 'aria-label': label, onChange: (e: Event) => onChange((e.target as HTMLSelectElement).value) }, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
      return h('div', { class: 'tm-page' }, toolbar('Settings'),
        h('div', { class: 'tm-settings' },
          h('div', { class: 'tm-set' }, h('span', null, h('strong', null, 'Default start page'), h('small', null, 'Which page Task Manager opens on')), selectEl(p.startPage ?? 'processes', NAV.map(([id, l]) => [id, l]), (v) => save({ startPage: v }), 'Default start page')),
          h('div', { class: 'tm-set' }, h('span', null, h('strong', null, 'Real time update speed'), h('small', null, 'How often the figures refresh')), selectEl(p.speed ?? 'normal', [['high', 'High'], ['normal', 'Normal'], ['low', 'Low'], ['paused', 'Paused']], (v) => save({ speed: v as Speed }), 'Update speed'))));
    }

    function draw(): void {
      const scroller = host.querySelector('.tm-scroll');
      const top = scroller?.scrollTop ?? 0;
      clear(host);
      const body = page === 'processes' ? processesPage() : page === 'performance' ? performancePage() : page === 'startup' ? startupPage() : page === 'users' ? usersPage() : page === 'details' ? detailsPage() : page === 'services' ? servicesPage() : settingsPage();
      const navBtn = (id: Page, label: string, icon: string): HTMLElement => h('button', { class: `tm-nav-item ${page === id ? 'on' : ''}`, type: 'button', title: label, 'aria-label': label, onClick: () => { page = id; selected = null; draw(); } }, h('span', { class: 'mdl' }, icon), navOpen ? h('span', null, label) : null);
      host.appendChild(h('div', { class: `tm ${navOpen ? '' : 'narrow'}` },
        h('nav', { class: 'tm-nav', 'aria-label': 'Task Manager' },
          h('button', { class: 'tm-nav-item', type: 'button', title: navOpen ? 'Collapse navigation' : 'Expand navigation', 'aria-label': 'Navigation', onClick: () => { navOpen = !navOpen; draw(); } }, h('span', { class: 'mdl' }, '')),
          NAV.map(([id, label, icon]) => navBtn(id, label, icon)),
          h('div', { class: 'tm-nav-fill' }),
          navBtn('settings', 'Settings', '')),
        body));
      const next = host.querySelector('.tm-scroll');
      if (next) next.scrollTop = top;
    }

    let timer = 0;
    const restartTimer = (): void => {
      clearInterval(timer);
      const ms = SPEED_MS[prefs().speed ?? 'normal'];
      if (!ms) return;
      timer = window.setInterval(() => {
        sample();
        // Leave the page alone while a menu is open or the search box is being typed in.
        if (document.querySelector('.cm') || (host.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement)) return;
        draw();
      }, ms);
    };
    for (let i = 0; i < 8; i++) sample();
    draw();
    restartTimer();
    return { dispose: () => clearInterval(timer) };
  },
};
