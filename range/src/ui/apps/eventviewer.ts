/**
 * ui/apps/eventviewer.ts — Event Viewer (eventvwr.msc).
 *
 * Every node in the console tree opens: the Overview and Summary, Custom Views
 * (Administrative Events), Windows Logs (Application, Security, Setup, System,
 * Forwarded Events), and Applications and Services Logs (Directory Service,
 * DNS Server, Windows PowerShell, Microsoft > Windows > Windows Defender >
 * Operational). The logs come from world/eventlog.ts.
 *
 * Working menus and toolbar (Back/Forward, show/hide the tree, filter,
 * refresh, properties), column sorting, arrow keys, double-click for Event
 * Properties, Filter Current Log (levels, ID lists, ranges and exclusions,
 * keywords), Find, Clear Log (which writes 1102 / 104, as Windows does), Save
 * All Events As CSV, and log Properties.
 */
import { clear, h, toast } from '../dom.ts';
import { act, persist, store } from '../store.ts';
import { type AppDef } from '../wm.ts';
import { showMenu, type MenuEntry } from '../ctxmenu.ts';
import { type SmallIcon, glyph } from '../icons.ts';
import { nowMs } from '../../core/time.ts';
import { toCsv } from '../../core/sheet.ts';
import { homeDir, writeFile } from '../../world/docs.ts';
import { type Level, type LogClear, type LogEvent, type LogName, LOGS, buildEventLogs, idFilter } from '../../world/eventlog.ts';

export interface EventViewerState { clears: LogClear[] }

interface Node { id: string; label: string; icon: SmallIcon; kind: 'root' | 'container' | 'log' | 'custom' | 'subs'; log?: LogName; children?: Node[] }

const DEF: LogName = 'Microsoft-Windows-Windows Defender/Operational';
const TREE: Node = { id: 'root', label: 'Event Viewer (Local)', icon: 'log', kind: 'root', children: [
  { id: 'custom', label: 'Custom Views', icon: 'container', kind: 'container', children: [
    { id: 'admin', label: 'Administrative Events', icon: 'filter', kind: 'custom' }] },
  { id: 'windows', label: 'Windows Logs', icon: 'container', kind: 'container', children: (['Application', 'Security', 'Setup', 'System', 'Forwarded Events'] as LogName[]).map((l) => ({ id: l, label: l, icon: 'log' as SmallIcon, kind: 'log' as const, log: l })) },
  { id: 'apps', label: 'Applications and Services Logs', icon: 'container', kind: 'container', children: [
    ...(['Directory Service', 'DNS Server', 'Windows PowerShell'] as LogName[]).map((l) => ({ id: l, label: l, icon: 'log' as SmallIcon, kind: 'log' as const, log: l })),
    { id: 'ms', label: 'Microsoft', icon: 'container', kind: 'container', children: [
      { id: 'ms-win', label: 'Windows', icon: 'container', kind: 'container', children: [
        { id: 'ms-def', label: 'Windows Defender', icon: 'container', kind: 'container', children: [
          { id: DEF, label: 'Operational', icon: 'log', kind: 'log', log: DEF }] }] }] }] },
  { id: 'subs', label: 'Subscriptions', icon: 'container', kind: 'subs' },
] };

const flat = (n: Node, parent: Node | null = null, out: { node: Node; parent: Node | null }[] = []): { node: Node; parent: Node | null }[] => {
  out.push({ node: n, parent });
  for (const c of n.children ?? []) flat(c, n, out);
  return out;
};
const ALL = flat(TREE);
const byId = (id: string): Node => ALL.find((x) => x.node.id === id)?.node ?? TREE;
const ADMIN_LEVELS: Level[] = ['Critical', 'Error', 'Warning'];
const LEVELS: Level[] = ['Critical', 'Error', 'Warning', 'Information', 'Verbose'];

const levelIcon = (l: Level): SmallIcon => (l === 'Error' || l === 'Critical' ? 'error' : l === 'Warning' ? 'warning' : l === 'Audit Success' ? 'keySuccess' : l === 'Audit Failure' ? 'lockFail' : 'info');
const isAudit = (l: LogName | undefined): boolean => l === 'Security';
const fmtTime = (iso: string): string => new Date(iso).toLocaleString();
const logSize = (n: number): string => `${Math.max(68, n * 4.3).toFixed(0)} KB`;

export const eventViewerApp: AppDef = {
  id: 'eventviewer',
  title: 'Event Viewer',
  icon: 'eventviewer',
  width: 1180,
  height: 700,
  mount(host, win) {
    let node = 'Security';
    const back: string[] = [];
    const fwd: string[] = [];
    const open = new Set(['root', 'windows', 'custom']);
    let selKey = '';
    let tab: 'general' | 'details' = 'general';
    let sort: { col: 'level' | 'time' | 'source' | 'id' | 'task' | 'log'; dir: 1 | -1 } = { col: 'time', dir: -1 };
    const filters = new Map<string, { levels: Level[]; ids: string; text: string }>();
    let showTree = true;
    let showActions = true;
    let showPreview = true;
    let logs = build();

    const layer = h('div', { class: 'mm-layer' });
    const root = h('div', { class: 'mm-root ev' });
    host.append(root, layer);
    const state = (): EventViewerState => (store.settings.eventViewer ??= { clears: [] });

    function build(): Record<LogName, LogEvent[]> {
      return buildEventLogs(store.world, { now: nowMs(), defender: store.settings.security, clears: store.settings.eventViewer?.clears });
    }
    const cur = (): Node => byId(node);
    function go(id: string): void {
      if (id === node) return;
      back.push(node); fwd.length = 0; node = id; selKey = '';
      for (const { node: n, parent } of ALL) if (n.id === id) { let p = parent; while (p) { open.add(p.id); p = ALL.find((x) => x.node.id === p!.id)?.parent ?? null; } }
      draw();
    }
    function events(n: Node = cur()): LogEvent[] {
      let list: LogEvent[] = n.kind === 'log' ? logs[n.log!] : n.kind === 'custom' ? LOGS.flatMap((l) => logs[l]).filter((e) => ADMIN_LEVELS.includes(e.level)) : [];
      const f = filters.get(n.id);
      if (f) {
        const ids = idFilter(f.ids);
        const t = f.text.toLowerCase();
        list = list.filter((e) => (!f.levels.length || f.levels.includes(e.level) || (e.level.startsWith('Audit') && f.levels.includes('Information'))) && (!ids || ids(e.eventId)) && (!t || `${e.source} ${e.message} ${e.user} ${e.computer}`.toLowerCase().includes(t)));
      }
      const key = (e: LogEvent): string | number => sort.col === 'time' ? e.time : sort.col === 'id' ? e.eventId : sort.col === 'source' ? e.source : sort.col === 'task' ? e.task : sort.col === 'log' ? e.log : e.level;
      return [...list].sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : b.key.localeCompare(a.key)) * sort.dir; });
    }

    // ------------------------------------------------------------ dialogs
    function dialog(title: string, icon: SmallIcon, body: HTMLElement, buttons: [string, () => boolean | void, boolean?][], width = 460): () => void {
      const shield = h('div', { class: 'mm-shield' });
      const close = (): void => { shield.remove(); };
      shield.appendChild(h('div', { class: 'mm-dlg active', role: 'dialog', 'aria-label': title, style: `width:min(${width}px, calc(100% - 16px))` },
        h('div', { class: 'mm-dlg-title' }, glyph(icon), h('span', { class: 't' }, title), h('button', { class: 'mm-dlg-x', type: 'button', 'aria-label': 'Close', onClick: close }, '✕')),
        h('div', { class: 'mm-dlg-body mm-stack' }, body),
        h('div', { class: 'mm-dlg-foot' }, ...buttons.map(([label, fn, def]) => h('button', { class: `mm-btn ${def ? 'default' : ''}`, type: 'button', onClick: () => { if (fn() !== false) close(); } }, label)))));
      shield.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
      layer.appendChild(shield);
      setTimeout(() => shield.querySelector<HTMLElement>('input, select, button.default')?.focus(), 20);
      return close;
    }
    function filterDialog(): void {
      const n = cur();
      if (n.kind !== 'log' && n.kind !== 'custom') return;
      const f = filters.get(n.id) ?? { levels: [], ids: '', text: '' };
      const boxes = LEVELS.map((l) => h('input', { type: 'checkbox', checked: f.levels.includes(l), 'aria-label': l }));
      const ids = h('input', { type: 'text', value: f.ids, placeholder: '<All Event IDs>', style: 'width:100%' });
      const words = h('input', { type: 'text', value: f.text, style: 'width:100%' });
      dialog('Filter Current Log', 'filter', h('div', { class: 'ev-form' },
        h('div', null, h('strong', null, 'Event level:'), h('div', { class: 'ev-levels' }, ...LEVELS.map((l, i) => h('label', null, boxes[i]!, l)))),
        h('div', null, h('div', null, 'Includes/Excludes Event IDs: Enter ID numbers and/or ID ranges separated by commas. To exclude criteria, type a minus sign first. For example 1,3,5-99,-76'), ids),
        h('div', null, h('div', null, 'User, computer or keyword:'), words)), [
        ['OK', () => {
          if (ids.value.trim() && !/^[\s\d,;-]+$/.test(ids.value)) { toast('The Event ID filter accepts numbers, ranges like 4720-4729 and exclusions like -4624.', 'err'); return false; }
          const next = { levels: LEVELS.filter((_, i) => boxes[i]!.checked), ids: ids.value.trim(), text: words.value.trim() };
          if (!next.levels.length && !next.ids && !next.text) filters.delete(n.id); else filters.set(n.id, next);
          selKey = ''; draw();
        }, true],
        ['Clear', () => { filters.delete(n.id); selKey = ''; draw(); }],
        ['Cancel', () => undefined]]);
    }
    function findDialog(): void {
      const n = cur();
      if (n.kind !== 'log' && n.kind !== 'custom') return;
      const q = h('input', { type: 'text', style: 'width:100%', 'aria-label': 'Find what' });
      const next = (): boolean => {
        const t = q.value.trim().toLowerCase();
        if (!t) return false;
        const list = events();
        const start = Math.max(0, list.findIndex((e) => e.key === selKey) + 1);
        const hit = [...list.slice(start), ...list.slice(0, start)].find((e) => `${e.source} ${e.eventId} ${e.message} ${e.user}`.toLowerCase().includes(t));
        if (!hit) { toast(`Event Viewer cannot find "${q.value}".`, 'info'); return false; }
        selKey = hit.key; draw(); revealSel();
        return false;
      };
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); next(); } });
      dialog('Find', 'find', h('div', null, h('div', null, 'Find what:'), q), [['Find Next', next, true], ['Cancel', () => undefined]], 380);
    }
    function clearDialog(): void {
      const n = cur();
      if (n.kind !== 'log') return;
      const doClear = (save: boolean): void => {
        if (save) saveEvents(n.log!, events(n), true);
        state().clears.push({ log: n.log!, time: new Date(nowMs()).toISOString(), by: store.world.player.adminSam });
        persist();
        logs = build(); selKey = ''; draw();
        toast(n.log === 'Security' ? 'The Security log was cleared. Event 1102 records who cleared it.' : `The ${n.log} log was cleared. System event 104 records it.`, 'info');
      };
      dialog('Event Viewer', 'warning', h('p', null, `Do you want to save the contents of ${n.label} before clearing it?`), [
        ['Save and Clear', () => doClear(true), true], ['Clear', () => doClear(false)], ['Cancel', () => undefined]], 420);
    }
    function saveEvents(log: string, list: LogEvent[], quiet = false): void {
      const name = `${log.replace(/[\\/:*?"<>|]/g, '-')}-${new Date(nowMs()).toISOString().slice(0, 10)}.csv`;
      const path = `${homeDir(store.world)}\\Documents\\${name}`;
      const body = toCsv([['Level', 'Date and Time', 'Source', 'Event ID', 'Task Category', 'Computer', 'User', 'Message'], ...list.map((e) => [e.level, fmtTime(e.time), e.source, String(e.eventId), e.task, e.computer, e.user, e.message.replace(/\t/g, ' ')])]);
      if (act((w) => writeFile(w, path, body)) && !quiet) toast(`Saved ${list.length} event(s) to Documents\\${name}`, 'ok');
    }
    function saveDialog(): void {
      const n = cur();
      if (n.kind !== 'log' && n.kind !== 'custom') return;
      const list = events(n);
      dialog('Save All Events As', 'log', h('div', null, h('p', null, `${list.length} event(s) from ${n.label} will be saved as comma-separated values (CSV) in Documents. Open the file in Excel to sort, filter and attach it to a ticket as evidence.`)),
        [['Save', () => saveEvents(n.label, list), true], ['Cancel', () => undefined]], 440);
    }
    function propertiesDialog(): void {
      const n = cur();
      if (n.kind !== 'log') return;
      const list = logs[n.log!];
      const file = n.log === DEF ? 'Microsoft-Windows-Windows Defender%4Operational' : n.log!.replace(/ /g, '');
      const rows: [string, string][] = [['Full Name:', n.log!], ['Log path:', `%SystemRoot%\\System32\\Winevt\\Logs\\${file}.evtx`], ['Log size:', `${logSize(list.length)} (${list.length} events)`],
        ['Created:', fmtTime(store.world.created)], ['Modified:', list[0] ? fmtTime(list[0].time) : fmtTime(store.world.created)], ['Accessed:', fmtTime(new Date(nowMs()).toISOString())]];
      dialog('Log Properties - ' + n.label, 'properties', h('div', { class: 'ev-props' },
        h('div', { class: 'ev-kv' }, ...rows.flatMap(([k, v]) => [h('span', null, k), h('span', null, v)])),
        h('label', null, h('input', { type: 'checkbox', checked: true, disabled: true }), 'Enable logging'),
        h('div', null, 'Maximum log size ( KB ): ', h('input', { type: 'text', value: n.log === 'Security' ? '131072' : '20480', disabled: true, style: 'width:90px' })),
        h('div', null, 'When maximum event log size is reached:'),
        h('label', null, h('input', { type: 'radio', checked: true, disabled: true }), 'Overwrite events as needed (oldest events first)'),
        h('p', { class: 'ev-note' }, n.log === 'Security' ? 'Managed by Group Policy: Default Domain Controllers Policy > Event Log. Security is forwarded to the SIEM, so a local clear still leaves a copy there.' : 'These settings are managed by your organization.')),
        [['OK', () => undefined, true], ['Cancel', () => undefined]], 520);
    }
    function eventProps(): void {
      const list = events();
      let i = list.findIndex((e) => e.key === selKey);
      if (i < 0) return;
      let t: 'general' | 'details' = 'general';
      const body = h('div', { class: 'ev-dlg' });
      const paint = (): void => {
        const e = list[i]!;
        clear(body);
        body.append(
          h('div', { class: 'mm-tabrow' }, ...(['general', 'details'] as const).map((k) => h('div', { class: `mm-tab ${t === k ? 'sel' : ''}`, onClick: () => { t = k; paint(); } }, k === 'general' ? 'General' : 'Details'))),
          h('div', { class: 'mm-tabpanel' }, t === 'general' ? generalPanel(e) : h('pre', { class: 'ev-msg tall' }, e.details)),
          h('div', { class: 'ev-dlg-nav' },
            h('button', { class: 'mm-btn', type: 'button', disabled: i === 0, onClick: () => { i--; selKey = list[i]!.key; paint(); } }, '▲ Previous'),
            h('button', { class: 'mm-btn', type: 'button', disabled: i === list.length - 1, onClick: () => { i++; selKey = list[i]!.key; paint(); } }, '▼ Next'),
            h('button', { class: 'mm-btn', type: 'button', onClick: () => copyEvent(list[i]!) }, 'Copy')));
      };
      paint();
      dialog(`Event Properties - Event ${list[i]!.eventId}, ${list[i]!.source}`, 'properties', body, [['Close', () => { draw(); }, true]], 720);
    }
    function copyEvent(e: LogEvent): void {
      const text = `Log Name:      ${e.log}\r\nSource:        ${e.source}\r\nDate:          ${fmtTime(e.time)}\r\nEvent ID:      ${e.eventId}\r\nTask Category: ${e.task}\r\nLevel:         ${e.level}\r\nKeywords:      ${e.keywords}\r\nUser:          ${e.user}\r\nComputer:      ${e.computer}\r\nDescription:\r\n${e.message.replace(/\n/g, '\r\n')}`;
      void navigator.clipboard?.writeText(text).then(() => toast('Event details copied to the clipboard.', 'ok'), () => toast('The clipboard is not available here.', 'err'));
    }
    function about(): void {
      dialog('About Event Viewer', 'info', h('div', null, h('p', null, h('strong', null, 'Event Viewer'), ' Version 1.0'), h('p', null, 'Microsoft Management Console 3.0, as simulated by Meridian IAM Range.'),
        h('p', null, 'Security shows the domain controller audit trail written by your actions: account changes (4720-4767), group changes (4728/4729), sign-ins (4624/4625/4634), Kerberos failures (4771) and lockouts (4740).')), [['OK', () => undefined, true]], 420);
    }
    const generalPanel = (e: LogEvent): HTMLElement => h('div', null, h('pre', { class: 'ev-msg' }, e.message), h('div', { class: 'ev-meta' },
      ...([['Log Name:', e.log], ['Source:', e.source], ['Logged:', fmtTime(e.time)], ['Event ID:', String(e.eventId)], ['Task Category:', e.task], ['Level:', e.level.startsWith('Audit') ? 'Information' : e.level], ['Keywords:', e.keywords], ['User:', e.user], ['OpCode:', 'Info'], ['Computer:', e.computer]] as [string, string][]).flatMap(([k, v]) => [h('span', null, k), h('span', { title: v }, v)])));

    // ------------------------------------------------------------ menus
    const menuAt = (anchor: HTMLElement, items: MenuEntry[]): void => { const r = anchor.getBoundingClientRect(); showMenu(r.left, r.bottom, items); };
    const isList = (): boolean => cur().kind === 'log' || cur().kind === 'custom';
    const sel = (): LogEvent | undefined => events().find((e) => e.key === selKey);
    const actionItems = (): MenuEntry[] => [
      { label: 'Open Saved Log...', disabled: true }, { label: 'Create Custom View...', disabled: true }, { label: 'Import Custom View...', disabled: true }, '-',
      { label: 'Clear Log...', disabled: cur().kind !== 'log', onClick: clearDialog },
      { label: 'Filter Current Log...', disabled: !isList(), onClick: filterDialog },
      { label: 'Clear Filter', disabled: !filters.has(cur().id), onClick: () => { filters.delete(cur().id); draw(); } },
      { label: 'Properties', disabled: cur().kind !== 'log', onClick: propertiesDialog },
      { label: 'Find...', disabled: !isList(), onClick: findDialog },
      { label: 'Save All Events As...', disabled: !isList(), onClick: saveDialog }, '-',
      { label: 'Event Properties', disabled: !sel(), onClick: eventProps },
      { label: 'Copy Details as Text', disabled: !sel(), onClick: () => { const e = sel(); if (e) copyEvent(e); } }, '-',
      { label: 'Refresh', shortcut: 'F5', onClick: refresh },
    ];
    const sortItems = (): MenuEntry[] => ([['level', 'Level'], ['time', 'Date and Time'], ['source', 'Source'], ['id', 'Event ID'], ['task', 'Task Category']] as [typeof sort.col, string][])
      .map(([c, l]) => ({ label: l, checked: sort.col === c, onClick: () => { sort = { col: c, dir: c === 'time' ? -1 : 1 }; draw(); } }));
    function refresh(): void { logs = build(); draw(); }

    function draw(): void {
      const n = cur();
      win.setTitle('Event Viewer');
      clear(root);
      // Menu bar
      const mb = (label: string, items: () => MenuEntry[]): HTMLElement => {
        const el = h('span', { tabIndex: 0, role: 'menuitem', onClick: () => menuAt(el, items()), onKeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); menuAt(el, items()); } } }, label);
        return el;
      };
      root.appendChild(h('div', { class: 'mm-menubar', role: 'menubar' },
        mb('File', () => [{ label: 'Open Saved Log...', disabled: true }, { label: 'Save All Events As...', disabled: !isList(), onClick: saveDialog }, '-', { label: 'Options...', disabled: true }, '-', { label: 'Exit', onClick: () => win.close() }]),
        mb('Action', actionItems),
        mb('View', () => [
          { label: 'Console Tree', checked: showTree, onClick: () => { showTree = !showTree; draw(); } },
          { label: 'Action Pane', checked: showActions, onClick: () => { showActions = !showActions; draw(); } },
          { label: 'Preview Pane', checked: showPreview, onClick: () => { showPreview = !showPreview; draw(); } }, '-',
          { label: 'Sort By', submenu: sortItems() }, '-',
          { label: 'Refresh', shortcut: 'F5', onClick: refresh }]),
        mb('Help', () => [{ label: 'Help Topics', onClick: about }, { label: 'About Event Viewer', onClick: about }])));
      // Toolbar
      const tb = (icon: SmallIcon, title: string, fn: (() => void) | null): HTMLButtonElement => h('button', { class: 'mm-tb', type: 'button', title, 'aria-label': title, disabled: !fn, onClick: () => fn?.() }, glyph(icon));
      root.appendChild(h('div', { class: 'mm-toolbar' },
        tb('back', 'Back', back.length ? () => { fwd.push(node); node = back.pop()!; selKey = ''; draw(); } : null),
        tb('forward', 'Forward', fwd.length ? () => { back.push(node); node = fwd.pop()!; selKey = ''; draw(); } : null),
        h('span', { class: 'mm-tbsep' }),
        tb('container', 'Show/Hide Console Tree', () => { showTree = !showTree; draw(); }),
        tb('properties', 'Properties', n.kind === 'log' ? propertiesDialog : null),
        h('span', { class: 'mm-tbsep' }),
        tb('filter', 'Filter Current Log...', isList() ? filterDialog : null),
        tb('find', 'Find...', isList() ? findDialog : null),
        tb('refresh', 'Refresh', refresh),
        h('span', { class: 'mm-tbsep' }),
        tb('info', 'Help', about)));

      const panes = h('div', { class: 'mm-panes' });
      if (showTree) panes.append(treeEl());
      panes.append(centerEl(n));
      if (showActions) panes.append(actionsEl(n));
      root.appendChild(panes);
      root.appendChild(h('div', { class: 'mm-status' }, isList() ? `${events().length} event(s) shown${filters.has(n.id) ? ' (filtered)' : ''}` : ''));
    }

    function treeEl(): HTMLElement {
      const el = h('div', { class: 'mm-tree', tabIndex: 0, role: 'tree', 'aria-label': 'Console tree' });
      const row = (n: Node, depth: number): void => {
        const has = !!n.children?.length;
        const isOpen = open.has(n.id);
        el.append(h('div', { class: `mm-trow ${n.id === node ? 'sel' : ''}`, role: 'treeitem', 'aria-expanded': has ? String(isOpen) : null, style: `padding-left:${depth * 16 + 2}px`,
          onClick: () => go(n.id),
          onDblclick: () => { if (has) { if (isOpen) open.delete(n.id); else open.add(n.id); draw(); } },
          onContextmenu: (e: MouseEvent) => { e.preventDefault(); go(n.id); showMenu(e.clientX, e.clientY, actionItems()); } },
          h('span', { class: 'mm-twisty', onClick: (e: Event) => { e.stopPropagation(); if (!has) return; if (isOpen) open.delete(n.id); else open.add(n.id); draw(); } }, has ? h('span', { class: `mm-chev ${isOpen ? 'open' : ''}` }) : null),
          glyph(n.icon), h('span', { class: 'mm-tlabel' }, n.label)));
        if (has && isOpen) for (const c of n.children!) row(c, depth + 1);
      };
      row(TREE, 0);
      el.addEventListener('keydown', (e) => {
        const visible = ALL.filter(({ node: x, parent }) => { let p = parent; while (p) { if (!open.has(p.id)) return false; p = ALL.find((y) => y.node.id === p!.id)?.parent ?? null; } return !!x; }).map((x) => x.node);
        const i = visible.findIndex((x) => x.id === node);
        if (e.key === 'ArrowDown' && i < visible.length - 1) { e.preventDefault(); go(visible[i + 1]!.id); focusTree(); }
        else if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); go(visible[i - 1]!.id); focusTree(); }
        else if (e.key === 'ArrowRight' && cur().children?.length) { e.preventDefault(); open.add(node); draw(); focusTree(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); if (open.has(node) && cur().children?.length) { open.delete(node); draw(); } else { const p = ALL.find((x) => x.node.id === node)?.parent; if (p) go(p.id); } focusTree(); }
      });
      return el;
    }
    const focusTree = (): void => { root.querySelector<HTMLElement>('.mm-tree')?.focus(); };
    const revealSel = (): void => { root.querySelector('tr.row.sel')?.scrollIntoView({ block: 'nearest' }); };

    function centerEl(n: Node): HTMLElement {
      if (n.kind === 'root') return overview();
      if (n.kind === 'subs') return h('div', { class: 'ev-center' }, h('div', { class: 'ev-head' }, h('strong', null, 'Subscriptions')), h('div', { class: 'mm-empty' }, 'There are no items to show in this view.'),
        h('p', { class: 'mm-empty ev-note' }, 'Subscriptions collect events from other computers (Windows Event Forwarding). The Windows Event Collector service is not running on this workstation.'));
      if (n.kind === 'container') {
        const kids = n.children ?? [];
        return h('div', { class: 'ev-center' }, h('div', { class: 'ev-head' }, h('strong', null, n.label), `   Number of items: ${kids.length}`),
          h('div', { class: 'mm-list' }, h('table', { class: 'mm-table' },
            h('thead', null, h('tr', null, ...['Name', 'Type', 'Number of Events', 'Size'].map((x) => h('th', null, x)))),
            h('tbody', null, ...kids.map((k) => h('tr', { class: 'row', onDblclick: () => { open.add(n.id); go(k.id); }, onClick: () => { open.add(n.id); go(k.id); } },
              h('td', null, h('span', { class: 'mm-cell' }, glyph(k.icon), h('span', null, k.label))), h('td', null, k.kind === 'log' ? (k.log === DEF ? 'Operational' : 'Administrative') : k.kind === 'custom' ? 'Custom View' : 'Folder'),
              h('td', null, k.kind === 'log' ? logs[k.log!].length.toLocaleString() : k.kind === 'custom' ? String(events(k).length) : ''), h('td', null, k.kind === 'log' ? logSize(logs[k.log!].length) : '')))))));
      }
      // A log or the Administrative Events custom view
      const list = events(n);
      const audit = isAudit(n.log);
      if (!list.some((e) => e.key === selKey)) selKey = '';
      const cols: [typeof sort.col, string, string][] = [['level', audit ? 'Keywords' : 'Level', '15%'], ['time', 'Date and Time', '20%'], ['source', 'Source', n.kind === 'custom' ? '22%' : '28%'], ['id', 'Event ID', '9%'], ['task', 'Task Category', n.kind === 'custom' ? '17%' : '28%'], ...(n.kind === 'custom' ? [['log', 'Log', '17%'] as [typeof sort.col, string, string]] : [])];
      const table = h('table', { class: 'mm-table' },
        h('colgroup', null, ...cols.map(([, , w]) => h('col', { style: `width:${w}` }))),
        h('thead', null, h('tr', null, ...cols.map(([c, label]) => h('th', { title: `Sort by ${label}`, onClick: () => { sort = { col: c, dir: sort.col === c ? (sort.dir === 1 ? -1 : 1) : (c === 'time' ? -1 : 1) }; draw(); } }, label, sort.col === c ? (sort.dir === 1 ? ' ▴' : ' ▾') : '')))),
        h('tbody', null, ...list.slice(0, 1000).map((e) => h('tr', { class: `row ${e.key === selKey ? 'sel' : ''}`, 'data-key': e.key,
          onClick: () => { selKey = e.key; draw(); root.querySelector<HTMLElement>('.ev-list')?.focus(); },
          onDblclick: () => { selKey = e.key; eventProps(); },
          onContextmenu: (ev: MouseEvent) => { ev.preventDefault(); selKey = e.key; draw(); showMenu(ev.clientX, ev.clientY, [{ label: 'Event Properties', bold: true, onClick: eventProps }, { label: 'Copy Details as Text', onClick: () => copyEvent(e) }, '-', { label: 'Filter Current Log...', onClick: filterDialog }, { label: 'Refresh', onClick: refresh }]); } },
          h('td', null, h('span', { class: 'mm-cell' }, glyph(levelIcon(e.level)), h('span', null, e.level))), h('td', null, fmtTime(e.time)), h('td', null, e.source), h('td', null, String(e.eventId)), h('td', null, e.task),
          n.kind === 'custom' ? h('td', null, e.log) : null))));
      const s = list.find((e) => e.key === selKey);
      const f = filters.get(n.id);
      const listEl = h('div', { class: 'mm-list ev-list', tabIndex: 0, 'data-keep-scroll': '', 'aria-label': `${n.label} events`,
        onKeydown: (ev: KeyboardEvent) => {
          const i = list.findIndex((e) => e.key === selKey);
          const to = (j: number): void => { ev.preventDefault(); const e = list[Math.max(0, Math.min(list.length - 1, j))]; if (e) { selKey = e.key; draw(); root.querySelector<HTMLElement>('.ev-list')?.focus(); revealSel(); } };
          if (ev.key === 'ArrowDown') to(i + 1); else if (ev.key === 'ArrowUp') to(i - 1); else if (ev.key === 'Home') to(0); else if (ev.key === 'End') to(list.length - 1);
          else if (ev.key === 'PageDown') to(i + 15); else if (ev.key === 'PageUp') to(i - 15);
          else if (ev.key === 'Enter' && s) { ev.preventDefault(); eventProps(); }
          else if (ev.key === 'F5') { ev.preventDefault(); refresh(); }
          else if (ev.ctrlKey && (ev.key ?? '').toLowerCase() === 'c' && s) { ev.preventDefault(); copyEvent(s); }
        } }, list.length ? table : h('div', { class: 'mm-empty' }, n.log === 'Forwarded Events' ? 'There are no items to show in this view. Forwarded Events collects events sent by other computers through a subscription.' : 'There are no items to show in this view.'));
      return h('div', { class: 'ev-center' },
        h('div', { class: 'ev-head' }, h('strong', null, n.label), `   Number of events: ${(n.kind === 'log' ? logs[n.log!].length : list.length).toLocaleString()}`),
        f ? h('div', { class: 'ev-filtered' }, glyph('filter'), `Filtered: Log: ${n.label}; ${f.levels.length ? `Level: ${f.levels.join(', ')}; ` : ''}${f.ids ? `Event ID: ${f.ids}; ` : ''}${f.text ? `Keyword: ${f.text}; ` : ''}Number of events: ${list.length.toLocaleString()}`) : null,
        listEl,
        showPreview ? h('div', { class: 'ev-detail' },
          h('div', { class: 'ev-detail-head' }, s ? `Event ${s.eventId}, ${s.source}` : 'Select an event to view its details.'),
          h('div', { class: 'mm-tabrow' }, ...(['general', 'details'] as const).map((k) => h('div', { class: `mm-tab ${tab === k ? 'sel' : ''}`, onClick: () => { tab = k; draw(); } }, k === 'general' ? 'General' : 'Details'))),
          h('div', { class: 'mm-tabpanel ev-panel' }, s ? (tab === 'general' ? generalPanel(s) : h('pre', { class: 'ev-msg' }, s.details)) : null)) : null);
    }

    function overview(): HTMLElement {
      const now = nowMs();
      const every = LOGS.flatMap((l) => logs[l]);
      const types: Level[] = ['Critical', 'Error', 'Warning', 'Information', 'Audit Success', 'Audit Failure'];
      const count = (t: Level, ms: number): number => every.filter((e) => e.level === t && now - Date.parse(e.time) <= ms).length;
      const logRows = ALL.filter((x) => x.node.kind === 'log').map((x) => x.node);
      return h('div', { class: 'ev-center ev-overview' },
        h('div', { class: 'ev-head' }, h('strong', null, 'Overview and Summary'), '   Last refreshed: ', new Date(now).toLocaleString()),
        h('div', { class: 'mm-list' },
          h('div', { class: 'ev-ov-sec' }, h('h3', null, 'Overview'), h('p', null, 'To view events that have occurred on your computer, select the appropriate source, log or custom view node in the console tree. The Administrative Events custom view contains all the administrative events, regardless of source.')),
          h('div', { class: 'ev-ov-sec' }, h('h3', null, 'Summary of Administrative Events'),
            h('table', { class: 'mm-table ev-ov-table' },
              h('thead', null, h('tr', null, ...['Event Type', 'Event ID', 'Source', 'Log', 'Last hour', '24 hours', '7 days'].map((x) => h('th', null, x)))),
              h('tbody', null, ...types.map((t) => h('tr', { class: 'row', onClick: () => { if (ADMIN_LEVELS.includes(t)) go('admin'); else if (t.startsWith('Audit')) go('Security'); } },
                h('td', null, h('span', { class: 'mm-cell' }, glyph(levelIcon(t)), h('span', null, t))), h('td', null, '-'), h('td', null, '-'), h('td', null, '-'),
                h('td', null, String(count(t, 3600_000))), h('td', null, String(count(t, 86400_000))), h('td', null, String(count(t, 7 * 86400_000)))))))),
          h('div', { class: 'ev-ov-sec' }, h('h3', null, 'Log Summary'),
            h('table', { class: 'mm-table ev-ov-table' },
              h('thead', null, h('tr', null, ...['Log Name', 'Size (Current/Maximum)', 'Modified', 'Enabled', 'Retention Policy'].map((x) => h('th', null, x)))),
              h('tbody', null, ...logRows.map((l) => h('tr', { class: 'row', onClick: () => go(l.id) },
                h('td', null, h('span', { class: 'mm-cell' }, glyph('log'), h('span', null, l.log!))), h('td', null, `${logSize(logs[l.log!].length)}/${l.log === 'Security' ? '128.00 MB' : '20.00 MB'}`),
                h('td', null, logs[l.log!][0] ? fmtTime(logs[l.log!][0]!.time) : '-'), h('td', null, 'Enabled'), h('td', null, 'Overwrite events as necessary'))))))));
    }

    function actionsEl(n: Node): HTMLElement {
      const act = (label: string, fn: (() => void) | null): HTMLButtonElement => h('button', { class: 'ev-act', type: 'button', disabled: !fn, onClick: () => fn?.() }, label);
      const s = isList() ? events().find((e) => e.key === selKey) : undefined;
      return h('div', { class: 'ev-actions' },
        h('div', { class: 'ev-act-head' }, 'Actions'),
        h('div', { class: 'ev-act-sub' }, n.label),
        act('Open Saved Log...', null), act('Create Custom View...', null), act('Import Custom View...', null),
        n.kind === 'log' ? act('Clear Log...', clearDialog) : null,
        isList() ? act('Filter Current Log...', filterDialog) : null,
        isList() && filters.has(n.id) ? act('Clear Filter', () => { filters.delete(n.id); draw(); }) : null,
        n.kind === 'log' ? act('Properties', propertiesDialog) : null,
        isList() ? act('Find...', findDialog) : null,
        isList() ? act('Save All Events As...', saveDialog) : null,
        act('Refresh', refresh), act('Help', about),
        s ? h('div', { class: 'ev-act-sub' }, `Event ${s.eventId}, ${s.source}`) : null,
        s ? act('Event Properties', eventProps) : null,
        s ? act('Copy Details as Text', () => copyEvent(s)) : null,
        s ? act('Save Selected Events...', () => saveEvents(`${n.label}-event-${s.eventId}`, [s])) : null);
    }

    root.addEventListener('keydown', (e) => { if (e.key === 'F5') { e.preventDefault(); refresh(); } });
    draw();
    // The world changes as you work (a lockout adds a 4740): rebuild the logs when it does.
    return { redraw: () => { if (!layer.childElementCount) refresh(); } };
  },
};
