/**
 * ServiceDesk: a ServiceNow-style ITSM. Tickets, approvals, work notes,
 * resolution codes, SLAs and raising Security Incidents.
 */
import { RESOLUTION_CODES, type ResolutionCode, type Ticket } from '../../core/types.ts';
import { fmt } from '../../core/time.ts';
import { addWorkNote, openTicket, resolveTicket, setTicketState, slaState } from '../../world/itsm.ts';
import { badge, button, field, h, table } from '../dom.ts';
import { act, store } from '../store.ts';
import { type Site, empty, kv, link, shell } from './common.ts';

type Filter = 'mine' | 'open' | 'security' | 'resolved' | 'all';

function stateBadge(t: Ticket): HTMLElement {
  const kind = t.state === 'Resolved' ? 'ok' : t.state === 'On Hold' ? 'warn' : t.state === 'New' ? 'info' : '';
  return badge(t.state, kind);
}

function slaBadge(t: Ticket): HTMLElement {
  const s = slaState(t);
  return badge(s === 'met' ? 'SLA met' : s === 'breached' ? 'SLA breached' : s === 'warning' ? `Due ${fmt(t.slaDue).slice(11)}` : `Due ${fmt(t.slaDue)}`, s === 'breached' ? 'bad' : s === 'warning' ? 'warn' : s === 'met' ? 'ok' : '');
}

function list(filter: Filter, go: (p: string) => void): HTMLElement {
  const w = store.world;
  const all = [...w.tickets].sort((a, b) => a.priority - b.priority || b.opened.localeCompare(a.opened));
  const rows = all.filter((t) => {
    if (filter === 'mine') return t.assignmentGroup === 'IAM Operations' && !['Resolved', 'Cancelled'].includes(t.state);
    if (filter === 'open') return !['Resolved', 'Cancelled'].includes(t.state);
    if (filter === 'security') return t.type === 'Security Incident';
    if (filter === 'resolved') return t.state === 'Resolved';
    return true;
  });
  const titles: Record<Filter, string> = { mine: 'IAM Operations: open work', open: 'All open tickets', security: 'Security Incidents', resolved: 'Resolved', all: 'All tickets' };
  return h('div', null,
    h('div', { class: 'row-between' }, h('h2', null, titles[filter]), button('New Security Incident', () => go('/new'), 'btn')),
    rows.length
      ? table(['Number', 'P', 'Short description', 'Caller', 'State', 'SLA', 'Opened'], rows.map((t) => [h('strong', null, t.id), `P${t.priority}`, t.short, t.caller, stateBadge(t), slaBadge(t), fmt(t.opened)]), (i) => go(`/ticket/${rows[i]!.id}`))
      : empty(filter === 'mine' ? 'The queue is empty. Open IAM Coach to start a lab or a shift.' : 'No tickets here.'));
}

function detail(t: Ticket, ctx: { go: (p: string) => void; open: (u: string) => void }): HTMLElement {
  const note = h('textarea', { class: 'input', rows: '3', placeholder: 'What did you check, what did you change, and why? Auditors read these.', 'aria-label': 'Work note' });
  const code = h('select', { class: 'input', 'aria-label': 'Resolution code' }, RESOLUTION_CODES.map((c) => h('option', { value: c }, c)));
  const resNotes = h('textarea', { class: 'input', rows: '3', placeholder: 'Resolution notes: the outcome and the evidence.', 'aria-label': 'Resolution notes' });
  const open = !['Resolved', 'Cancelled'].includes(t.state);
  return h('div', { class: 'ticket' },
    h('div', { class: 'row-between' },
      h('div', null, link('← Queue', () => ctx.go('/')), h('h2', null, `${t.id}: ${t.short}`)),
      h('div', { class: 'row' }, stateBadge(t), slaBadge(t))),
    kv([
      ['Type', t.type], ['Priority', `P${t.priority}`], ['Caller', t.caller], ['Requested for', t.requestedFor], ['Category', t.category],
      ['Assignment group', t.assignmentGroup], ['Opened', fmt(t.opened)], ['SLA due', fmt(t.slaDue)],
    ]),
    h('h3', null, 'Description'),
    h('pre', { class: 'desc' }, t.description),
    Object.keys(t.variables).length ? [h('h3', null, 'Request variables'), kv(Object.entries(t.variables))] : null,
    t.approvals.length ? [h('h3', null, 'Approvals'), table(['Approver', 'Role', 'State', 'When'], t.approvals.map((a) => [a.approver, a.role, badge(a.state, a.state === 'Approved' ? 'ok' : a.state === 'Rejected' ? 'bad' : 'warn'), fmt(a.time)]))] : null,
    h('div', { class: 'row' }, h('span', { class: 'muted' }, 'Look up the people in'), link('PeopleHub', () => ctx.open('https://peoplehub.meridianhealth.test/'))),
    h('h3', null, 'Work notes'),
    t.workNotes.length ? h('ol', { class: 'notes' }, t.workNotes.map((n) => h('li', null, h('span', { class: 'muted' }, `${fmt(n.time)} by ${n.author}`), h('p', null, n.text)))) : h('p', { class: 'muted' }, 'No work notes yet.'),
    open ? h('div', { class: 'stack' }, note, h('div', { class: 'row' },
      button('Add work note', () => { if (act((w) => addWorkNote(w, t.id, note.value), 'Work note added')) note.value = ''; }, 'btn primary'),
      button('Put On Hold', () => act((w) => setTicketState(w, t.id, 'On Hold'), `${t.id} is On Hold`)),
      button('Cancel ticket', () => act((w) => setTicketState(w, t.id, 'Cancelled'), `${t.id} cancelled`), 'btn ghost'))) : null,
    t.resolution
      ? h('div', { class: 'resolved' }, h('h3', null, 'Resolution'), kv([['Code', t.resolution.code], ['Resolved', fmt(t.resolution.time)], ['Notes', t.resolution.notes]]),
          button('Reopen', () => act((w) => setTicketState(w, t.id, 'In Progress'), `${t.id} reopened`)))
      : h('div', { class: 'stack resolve' }, h('h3', null, 'Resolve'), field('Resolution code', code), field('Resolution notes', resNotes),
          button(`Resolve ${t.id}`, () => act((w) => resolveTicket(w, t.id, code.value as ResolutionCode, resNotes.value), `${t.id} resolved`), 'btn primary')),
  );
}

function newIncident(go: (p: string) => void): HTMLElement {
  const short = h('input', { class: 'input', placeholder: 'e.g. Password spray from 192.0.2.66', 'aria-label': 'Short description' });
  const desc = h('textarea', { class: 'input', rows: '6', placeholder: 'What you saw, the evidence (IPs, accounts, times, event IDs) and what you have already contained.', 'aria-label': 'Description' });
  const pri = h('select', { class: 'input', 'aria-label': 'Priority' }, [1, 2, 3].map((p) => h('option', { value: String(p) }, `P${p}`)));
  pri.value = '2';
  return h('div', { class: 'stack narrow' },
    link('← Queue', () => go('/')),
    h('h2', null, 'New Security Incident'),
    h('p', { class: 'muted' }, 'Goes to Security Operations. Include the indicators so they can act without asking you again.'),
    field('Short description', short), field('Description', desc), field('Priority', pri),
    button('Create Security Incident', () => {
      let id = '';
      if (act((w) => { if (!short.value.trim()) throw new Error('Short description is required.'); id = openTicket(w, { type: 'Security Incident', category: 'Security', priority: Number(pri.value) as 1, caller: w.player.displayName, short: short.value.trim(), description: desc.value.trim() }).id; }, 'Security Incident created')) go(`/ticket/${id}`);
    }, 'btn primary'));
}

export const serviceDesk: Site = {
  host: 'servicedesk.meridianhealth.test',
  name: 'ServiceDesk',
  short: 'ServiceDesk',
  color: '#1f6f66',
  render(ctx) {
    const nav: [string, string][] = [['My queue', '/'], ['All open', '/open'], ['Security Incidents', '/security'], ['Resolved', '/resolved'], ['All tickets', '/all']];
    let content: HTMLElement;
    const m = /^\/ticket\/(.+)$/.exec(ctx.path);
    if (m) {
      const t = store.world.tickets.find((x) => x.id === decodeURIComponent(m[1]!));
      content = t ? detail(t, ctx) : empty('Ticket not found.');
    } else if (ctx.path === '/new') content = newIncident(ctx.go);
    else content = list((({ '/open': 'open', '/security': 'security', '/resolved': 'resolved', '/all': 'all' }) as Record<string, Filter>)[ctx.path] ?? 'mine', ctx.go);
    return shell(this, nav, ctx, content, 'Assignment group: IAM Operations');
  },
};
